package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/infra/docker"
	"github.com/websoft9/appos/backend/infra/fileutil"
	"gopkg.in/yaml.v3"
)

var sourceWorkspaceBasePath = "/appos/data"
var sourceWorkspaceAllowedRoots = []string{"apps", "templates", "workflows"}
var runtimePullIdleHeartbeatInterval = 20 * time.Second
var runtimeImagePullTimeout = 3 * time.Minute
var runtimeMirrorRetryCount = 2

func runtimeExecutorApp(executor Executor) core.App {
	type appAwareExecutor interface {
		App() core.App
	}
	if typed, ok := executor.(appAwareExecutor); ok {
		return typed.App()
	}
	switch typed := executor.(type) {
	case localExecutor:
		return typed.app
	case *localExecutor:
		return typed.app
	case sshExecutor:
		return typed.app
	case *sshExecutor:
		return typed.app
	default:
		return nil
	}
}

func loadRuntimePullIdleHeartbeatInterval(app core.App) time.Duration {
	group, _ := sysconfig.GetGroup(app, "deploy", "runtime", settingsschema.DefaultGroup("deploy", "runtime"))
	seconds := sysconfig.Int(group, "runtimePullIdleHeartbeatSeconds", int((20 * time.Second) / time.Second))
	if seconds < 1 {
		seconds = 1
	}
	return time.Duration(seconds) * time.Second
}

func loadRuntimeHealthCheckTimeout(app core.App) time.Duration {
	group, _ := sysconfig.GetGroup(app, "deploy", "runtime", settingsschema.DefaultGroup("deploy", "runtime"))
	seconds := sysconfig.Int(group, "healthCheckTimeoutSeconds", int((2 * time.Minute) / time.Second))
	if seconds < 1 {
		seconds = 1
	}
	return time.Duration(seconds) * time.Second
}

func loadRuntimeImagePullTimeout(app core.App) time.Duration {
	if app == nil {
		return runtimeImagePullTimeout
	}
	group, _ := sysconfig.GetGroup(app, "deploy", "runtime", settingsschema.DefaultGroup("deploy", "runtime"))
	seconds := sysconfig.Int(group, "imagePullTimeoutSeconds", int(runtimeImagePullTimeout/time.Second))
	if seconds < 1 {
		seconds = 1
	}
	return time.Duration(seconds) * time.Second
}

func SetSourceWorkspaceBasePathForTest(basePath string) func() {
	previous := sourceWorkspaceBasePath
	sourceWorkspaceBasePath = basePath
	return func() {
		sourceWorkspaceBasePath = previous
	}
}

type HealthChecker func(ctx context.Context, client interface {
	Exec(context.Context, ...string) (string, error)
}, projectDir string) error

type NodeExecutionHooks struct {
	Logf        func(string)
	HealthCheck HealthChecker
}

type NodeExecutionResult struct {
	DockerClient     *docker.Client
	OperationChanged bool
}

func ExecuteNode(
	ctx context.Context,
	operation *core.Record,
	node model.NodeDefinition,
	executor Executor,
	dockerClient *docker.Client,
	hooks NodeExecutionHooks,
) (NodeExecutionResult, error) {
	if operation == nil {
		return NodeExecutionResult{}, fmt.Errorf("operation is required")
	}
	if executor == nil {
		return NodeExecutionResult{}, fmt.Errorf("executor is required")
	}

	logf := hooks.Logf
	if logf == nil {
		logf = func(string) {}
	}
	healthCheck := hooks.HealthCheck
	if healthCheck == nil {
		healthCheck = RunDeploymentHealthCheck
	}

	result := NodeExecutionResult{DockerClient: dockerClient}

	switch node.NodeType {
	case "validation":
		if err := deploy.ValidateManualCompose(operation.GetString("rendered_compose")); err != nil {
			return result, err
		}
		logf("compose validation passed")
		return result, nil
	case "workspace":
		if err := executor.PrepareWorkspace(operation.GetString("project_dir"), operation.GetString("rendered_compose")); err != nil {
			return result, err
		}
		logf(executor.Name() + " workspace prepared: " + operation.GetString("project_dir"))
		return result, nil
	case "runtime_config":
		if operation.Get("resolved_env_json") == nil {
			operation.Set("resolved_env_json", map[string]any{})
			result.OperationChanged = true
		}
		logf("runtime config rendered")
		return result, nil
	case "source_workspace":
		workspaceRef := operationSourceBuildString(operation, "workspace_ref")
		if strings.TrimSpace(workspaceRef) == "" {
			return result, fmt.Errorf("source_build.workspace_ref is required for source workspace hydration")
		}
		if executor.Name() != "local" {
			return result, fmt.Errorf("source workspace hydration for executor %q is not implemented yet", executor.Name())
		}
		sourceAbs, err := fileutil.ResolveSafePath(sourceWorkspaceBasePath, workspaceRef, sourceWorkspaceAllowedRoots)
		if err != nil {
			return result, fmt.Errorf("invalid source_build.workspace_ref: %w", err)
		}
		info, err := os.Stat(sourceAbs)
		if err != nil {
			return result, err
		}
		if !info.IsDir() {
			return result, fmt.Errorf("source_build.workspace_ref must resolve to a directory")
		}
		targetDir := filepath.Join(operation.GetString("project_dir"), "src")
		if err := fileutil.CopyDir(sourceAbs, targetDir); err != nil {
			return result, err
		}
		logf("source workspace hydrated: " + workspaceRef + " -> " + targetDir)
		return result, nil
	case "artifact_build":
		builderStrategy := operationSourceBuildString(operation, "builder_strategy")
		if builderStrategy == "" {
			return result, fmt.Errorf("source_build.builder_strategy is required for artifact build")
		}
		if builderStrategy != "buildpacks" {
			return result, fmt.Errorf("source_build.builder_strategy %q is not supported yet", builderStrategy)
		}
		sourceDir := filepath.Join(operation.GetString("project_dir"), "src")
		info, err := os.Stat(sourceDir)
		if err != nil {
			return result, err
		}
		if !info.IsDir() {
			return result, fmt.Errorf("source build workspace %q is not a directory", sourceDir)
		}
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		if client == nil {
			return result, fmt.Errorf("docker client is required for artifact build")
		}
		result.DockerClient = client
		imageName := operationSourceBuildNestedString(operation, "artifact_publication", "image_name")
		imageTag := operationSourceBuildNestedString(operation, "artifact_publication", "image_tag")
		localImageRef := placeholderArtifactDigest(imageName, imageTag)
		buildOutput, err := client.ImageBuild(ctx, localImageRef, sourceDir)
		if buildOutput != "" {
			logf("docker image build output:\n" + buildOutput)
		}
		if err != nil {
			return result, err
		}
		buildResult := map[string]any{
			"status":                 "local_image_built",
			"builder_strategy":       builderStrategy,
			"source_dir":             sourceDir,
			"publication_mode":       normalizedPublicationMode(operationSourceBuildNestedString(operation, "artifact_publication", "mode")),
			"image_name":             imageName,
			"image_tag":              normalizedImageTag(imageTag),
			"local_image_ref":        localImageRef,
			"local_image_id":         inspectLocalImageID(ctx, client, localImageRef),
			"target_ref":             operationSourceBuildNestedString(operation, "artifact_publication", "target_ref"),
			"expected_artifact_kind": operationSourceBuildNestedString(operation, "artifact_publication", "expected_artifact_kind"),
			"recorded_at":            time.Now().UTC().Format(time.RFC3339),
		}
		if buildResult["expected_artifact_kind"] == "" {
			buildResult["expected_artifact_kind"] = "oci-image"
		}
		changed, err := setOperationSourceBuildValue(operation, "build_result", buildResult)
		if err != nil {
			return result, err
		}
		result.OperationChanged = result.OperationChanged || changed
		logf("artifact build recorded local image: " + localImageRef)
		return result, nil
	case "artifact_publish":
		buildResult, ok := operationSourceBuildNestedMap(operation, "build_result")
		if !ok {
			return result, fmt.Errorf("source_build.build_result is required for artifact publication")
		}
		if strings.TrimSpace(stringMapValue(buildResult, "status")) == "" {
			return result, fmt.Errorf("source_build.build_result.status is required for artifact publication")
		}
		publication := map[string]any{
			"status":                 "ready_for_release_candidate",
			"publication_mode":       normalizedPublicationMode(operationSourceBuildNestedString(operation, "artifact_publication", "mode")),
			"target_ref":             operationSourceBuildNestedString(operation, "artifact_publication", "target_ref"),
			"image_name":             operationSourceBuildNestedString(operation, "artifact_publication", "image_name"),
			"image_tag":              operationSourceBuildNestedString(operation, "artifact_publication", "image_tag"),
			"expected_artifact_kind": stringMapValue(buildResult, "expected_artifact_kind"),
			"recorded_at":            time.Now().UTC().Format(time.RFC3339),
		}
		if strings.TrimSpace(stringMapValue(publication, "image_tag")) == "" {
			publication["image_tag"] = "candidate"
		}
		if publication["expected_artifact_kind"] == "" {
			publication["expected_artifact_kind"] = "oci-image"
		}
		publication["artifact_digest"] = localArtifactRef(buildResult, publication)
		publication["local_image_ref"] = stringMapValue(publication, "artifact_digest")
		if strings.EqualFold(stringMapValue(publication, "publication_mode"), "local") {
			publication["status"] = "local_available"
		}
		resolvedTargetRef, resolutionState, resolutionMessage := resolvePublicationTargetRef(stringMapValue(publication, "target_ref"))
		if resolvedTargetRef != "" {
			publication["resolved_target_ref"] = resolvedTargetRef
		}
		if resolutionState != "" {
			publication["resolution_state"] = resolutionState
		}
		if resolutionMessage != "" {
			publication["resolution_message"] = resolutionMessage
		}

		if strings.EqualFold(stringMapValue(publication, "publication_mode"), "push") {
			if resolvedTargetRef != "" {
				client, err := ensureDockerClient(executor, dockerClient)
				if err != nil {
					return result, err
				}
				if client == nil {
					return result, fmt.Errorf("docker client is required for artifact publication")
				}
				result.DockerClient = client
				sourceRef := localArtifactRef(buildResult, publication)
				if _, err := client.ImageTag(ctx, sourceRef, resolvedTargetRef); err != nil {
					return result, err
				}
				logf("artifact tagged for publication: " + sourceRef + " -> " + resolvedTargetRef)
				pushOutput, err := client.ImagePush(ctx, resolvedTargetRef)
				if pushOutput != "" {
					logf("docker image push output:\n" + pushOutput)
				}
				if err != nil {
					return result, err
				}
				if digest := inspectArtifactDigest(ctx, client, resolvedTargetRef); digest != "" {
					publication["artifact_digest"] = digest
				}
				publication["published_ref"] = resolvedTargetRef
				publication["status"] = "published"
			} else if resolutionMessage != "" {
				logf("artifact publication target unresolved: " + resolutionMessage)
			}
		}
		changed, err := setOperationSourceBuildValue(operation, "publication_result", publication)
		if err != nil {
			return result, err
		}
		result.OperationChanged = result.OperationChanged || changed
		logf("artifact publication placeholder recorded for image: " + stringMapValue(publication, "image_name"))
		return result, nil
	case "release_candidate":
		return result, fmt.Errorf("source build node %q is not implemented yet", node.NodeType)
	case "runtime_start":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		var output string
		if strings.TrimSpace(operation.GetString("operation_type")) == string(model.OperationTypeStart) {
			output, err = client.ComposeStart(ctx, operation.GetString("project_dir"))
		} else {
			output, err = client.ComposeUp(ctx, operation.GetString("project_dir"))
		}
		if output != "" {
			logf("docker runtime start output:\n" + output)
		}
		if err != nil {
			return result, err
		}
		return result, nil
	case "runtime_pull":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		app := runtimeExecutorApp(executor)
		composePullErr := streamRuntimeComposePull(ctx, client, operation.GetString("project_dir"), app, logf)
		if composePullErr == nil {
			return result, nil
		}
		mirrors := loadRuntimeDockerMirrors(app)
		if len(mirrors) == 0 {
			return result, composePullErr
		}
		logf("docker runtime upstream pull failed, switching to configured mirrors")
		if err := pullRuntimeImagesWithMirrors(ctx, app, client, operation.GetString("rendered_compose"), mirrors, logf); err != nil {
			return result, err
		}
		return result, nil
	case "runtime_stop":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		output, err := client.ComposeStop(ctx, operation.GetString("project_dir"))
		if output != "" {
			logf("docker compose stop output:\n" + output)
		}
		if err != nil {
			return result, err
		}
		return result, nil
	case "runtime_restart":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		output, err := client.ComposeRestart(ctx, operation.GetString("project_dir"))
		if output != "" {
			logf("docker compose restart output:\n" + output)
		}
		if err != nil {
			return result, err
		}
		return result, nil
	case "runtime_check":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		composeFile := operation.GetString("project_dir") + "/docker-compose.yml"
		output, err := client.Exec(ctx, "compose", "-f", composeFile, "ps", "--status", "running", "-q")
		if err != nil {
			return result, err
		}
		if strings.TrimSpace(output) != "" {
			return result, fmt.Errorf("runtime still reports running services")
		}
		logf("runtime check passed")
		return result, nil
	case "retirement":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		removeVolumes := operationMetadataBool(operation, "remove_volumes")
		output, err := client.ComposeDown(ctx, operation.GetString("project_dir"), removeVolumes)
		if output != "" {
			logf("docker compose down output:\n" + output)
		}
		if err != nil {
			return result, err
		}
		return result, nil
	case "health_check":
		client, err := ensureDockerClient(executor, dockerClient)
		if err != nil {
			return result, err
		}
		result.DockerClient = client
		healthTimeout := 2 * time.Minute
		if app := runtimeExecutorApp(executor); app != nil {
			healthTimeout = loadRuntimeHealthCheckTimeout(app)
		}
		healthCtx, cancel := context.WithTimeout(ctx, healthTimeout)
		defer cancel()
		if err := healthCheck(healthCtx, client, operation.GetString("project_dir")); err != nil {
			return result, err
		}
		logf("health check passed")
		return result, nil
	default:
		logf("skipped unsupported node type: " + node.NodeType)
		return result, nil
	}
}

func scanStreamLinesAndCarriageReturns(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	for index, b := range data {
		if b != '\n' && b != '\r' {
			continue
		}
		advance = index + 1
		if b == '\r' && advance < len(data) && data[advance] == '\n' {
			advance++
		}
		return advance, data[:index], nil
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

func formatRuntimePullIdleDuration(value time.Duration) time.Duration {
	if value < time.Second {
		return value.Round(10 * time.Millisecond)
	}
	return value.Round(time.Second)
}

func operationMetadataBool(operation *core.Record, key string) bool {
	if operation == nil || strings.TrimSpace(key) == "" {
		return false
	}
	raw := operation.Get("spec_json")
	spec, ok := raw.(map[string]any)
	if !ok {
		encoded, err := json.Marshal(raw)
		if err != nil {
			return false
		}
		if err := json.Unmarshal(encoded, &spec); err != nil {
			return false
		}
	}
	metadata, ok := spec["metadata"].(map[string]any)
	if !ok {
		return false
	}
	value, ok := metadata[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
	default:
		return false
	}
}

func operationSourceBuildString(operation *core.Record, key string) string {
	value, ok := operationSourceBuildValue(operation, key)
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func operationSourceBuildNestedString(operation *core.Record, parentKey, key string) string {
	if operation == nil || strings.TrimSpace(parentKey) == "" || strings.TrimSpace(key) == "" {
		return ""
	}
	parent, ok := operationSourceBuildValue(operation, parentKey)
	if !ok {
		return ""
	}
	parentMap, ok := parent.(map[string]any)
	if !ok {
		return ""
	}
	value, ok := parentMap[key]
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func operationSourceBuildNestedMap(operation *core.Record, key string) (map[string]any, bool) {
	value, ok := operationSourceBuildValue(operation, key)
	if !ok {
		return nil, false
	}
	direct, ok := value.(map[string]any)
	if ok {
		return direct, true
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var parsed map[string]any
	if err := json.Unmarshal(encoded, &parsed); err != nil {
		return nil, false
	}
	return parsed, true
}

func operationSourceBuildValue(operation *core.Record, key string) (any, bool) {
	if operation == nil || strings.TrimSpace(key) == "" {
		return nil, false
	}
	spec, ok := operationSpecMap(operation)
	if !ok {
		return nil, false
	}
	sourceBuild, ok := spec["source_build"].(map[string]any)
	if !ok {
		return nil, false
	}
	value, ok := sourceBuild[key]
	if !ok {
		return nil, false
	}
	return value, true
}

func setOperationSourceBuildValue(operation *core.Record, key string, value any) (bool, error) {
	if operation == nil || strings.TrimSpace(key) == "" {
		return false, fmt.Errorf("operation and key are required")
	}
	spec, ok := operationSpecMap(operation)
	if !ok {
		return false, fmt.Errorf("operation spec_json is invalid")
	}
	sourceBuild, ok := spec["source_build"].(map[string]any)
	if !ok {
		return false, fmt.Errorf("operation spec_json.source_build is invalid")
	}
	sourceBuild[key] = value
	spec["source_build"] = sourceBuild
	operation.Set("spec_json", spec)
	return true, nil
}

func operationSpecMap(operation *core.Record) (map[string]any, bool) {
	if operation == nil {
		return nil, false
	}
	raw := operation.Get("spec_json")
	spec, ok := raw.(map[string]any)
	if ok {
		return spec, true
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, false
	}
	if err := json.Unmarshal(encoded, &spec); err != nil {
		return nil, false
	}
	return spec, true
}

func stringMapValue(values map[string]any, key string) string {
	if len(values) == 0 || strings.TrimSpace(key) == "" {
		return ""
	}
	value, ok := values[key]
	if !ok {
		return ""
	}
	stringValue, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(stringValue)
}

func placeholderArtifactDigest(imageName, imageTag string) string {
	imageName = strings.TrimSpace(imageName)
	if imageName == "" {
		return ""
	}
	imageTag = strings.TrimSpace(imageTag)
	if imageTag == "" {
		imageTag = "candidate"
	}
	return imageName + ":" + imageTag
}

func normalizedImageTag(imageTag string) string {
	trimmed := strings.TrimSpace(imageTag)
	if trimmed == "" {
		return "candidate"
	}
	return trimmed
}

func localArtifactRef(buildResult map[string]any, publication map[string]any) string {
	if localImageRef := stringMapValue(buildResult, "local_image_ref"); localImageRef != "" {
		return localImageRef
	}
	return placeholderArtifactDigest(stringMapValue(publication, "image_name"), stringMapValue(publication, "image_tag"))
}

func normalizedPublicationMode(mode string) string {
	trimmed := strings.TrimSpace(mode)
	if trimmed == "" {
		return "local"
	}
	return trimmed
}

func isConcreteImageReference(ref string) bool {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return false
	}
	return !strings.Contains(trimmed, "://")
}

func resolvePublicationTargetRef(targetRef string) (resolvedRef, resolutionState, resolutionMessage string) {
	trimmed := strings.TrimSpace(targetRef)
	if trimmed == "" {
		return "", "", ""
	}
	if isConcreteImageReference(trimmed) {
		return trimmed, "resolved", ""
	}
	if strings.HasPrefix(trimmed, "registry://default/") {
		return "", "unresolved", "default registry target is symbolic and no concrete registry resolver is configured"
	}
	return "", "unresolved", "artifact publication target is symbolic and cannot be pushed without resolution"
}

func inspectArtifactDigest(ctx context.Context, client *docker.Client, ref string) string {
	if client == nil || strings.TrimSpace(ref) == "" {
		return ""
	}
	output, err := client.ImageInspect(ctx, ref)
	if err != nil {
		return ""
	}
	var records []struct {
		RepoDigests []string `json:"RepoDigests"`
	}
	if err := json.Unmarshal([]byte(output), &records); err != nil {
		return ""
	}
	for _, record := range records {
		for _, digest := range record.RepoDigests {
			if strings.TrimSpace(digest) != "" {
				return strings.TrimSpace(digest)
			}
		}
	}
	return ""
}

func inspectLocalImageID(ctx context.Context, client *docker.Client, ref string) string {
	if client == nil || strings.TrimSpace(ref) == "" {
		return ""
	}
	output, err := client.ImageInspect(ctx, ref)
	if err != nil {
		return ""
	}
	var records []struct {
		ID string `json:"Id"`
	}
	if err := json.Unmarshal([]byte(output), &records); err != nil {
		return ""
	}
	for _, record := range records {
		if strings.TrimSpace(record.ID) != "" {
			return strings.TrimSpace(record.ID)
		}
	}
	return ""
}

func ensureDockerClient(executor Executor, current *docker.Client) (*docker.Client, error) {
	if current != nil {
		return current, nil
	}
	return executor.DockerClient()
}

func streamRuntimeComposePull(ctx context.Context, client *docker.Client, projectDir string, app core.App, logf func(string)) error {
	stream, err := client.ComposePullStream(ctx, projectDir)
	if err != nil {
		return err
	}

	lineCh := make(chan string)
	errCh := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stream)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)
		scanner.Split(scanStreamLinesAndCarriageReturns)
		for scanner.Scan() {
			lineCh <- scanner.Text()
		}
		close(lineCh)
		errCh <- scanner.Err()
	}()

	heartbeatInterval := runtimePullIdleHeartbeatInterval
	if app != nil {
		heartbeatInterval = loadRuntimePullIdleHeartbeatInterval(app)
	}
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	hasOutput := false
	lastLoggedLine := ""
	lastActivityAt := time.Now().UTC()
	lastDiagnosticLine := ""
	for {
		select {
		case rawLine, ok := <-lineCh:
			if !ok {
				lineCh = nil
				continue
			}
			line := strings.TrimSpace(rawLine)
			if line == "" {
				continue
			}
			lastActivityAt = time.Now().UTC()
			lastDiagnosticLine = line
			if line == lastLoggedLine {
				continue
			}
			hasOutput = true
			lastLoggedLine = line
			logf("docker runtime pull: " + line)
		case <-ticker.C:
			rawIdleFor := time.Since(lastActivityAt)
			if rawIdleFor < heartbeatInterval {
				continue
			}
			idleFor := formatRuntimePullIdleDuration(rawIdleFor)
			if lastDiagnosticLine != "" {
				logf(fmt.Sprintf("docker runtime pull still waiting for new output after %s; last event: %s", idleFor, lastDiagnosticLine))
			} else {
				logf(fmt.Sprintf("docker runtime pull still waiting for first progress update after %s", idleFor))
			}
		case scanErr := <-errCh:
			if scanErr != nil {
				return scanErr
			}
			if err := stream.Close(); err != nil {
				if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
					idleFor := formatRuntimePullIdleDuration(time.Since(lastActivityAt))
					if lastDiagnosticLine != "" {
						return fmt.Errorf("docker runtime pull interrupted after %s without new output; last event: %s: %w", idleFor, lastDiagnosticLine, err)
					}
					return fmt.Errorf("docker runtime pull interrupted before any progress output after %s: %w", idleFor, err)
				}
				return err
			}
			if !hasOutput {
				logf("docker runtime pull completed with no incremental output")
			}
			return nil
		}
	}
}

func pullRuntimeImagesWithMirrors(
	ctx context.Context,
	app core.App,
	client *docker.Client,
	rawCompose string,
	mirrors []string,
	logf func(string),
) error {
	images, err := extractRuntimeComposeImageReferences(rawCompose)
	if err != nil {
		return err
	}
	if len(images) == 0 {
		logf("docker runtime pull completed with no image references")
		return nil
	}

	pullTimeout := loadRuntimeImagePullTimeout(app)
	for _, image := range images {
		if _, err := client.ImageInspect(ctx, image); err == nil {
			logf("docker runtime image already available locally: " + image)
			continue
		}

		if err := pullRuntimeImageWithMirrors(ctx, client, image, mirrors, pullTimeout, logf); err != nil {
			return err
		}
	}
	return nil
}

func pullRuntimeImageWithMirrors(
	ctx context.Context,
	client *docker.Client,
	image string,
	mirrors []string,
	pullTimeout time.Duration,
	logf func(string),
) error {
	var mirrorErrors []string
	for _, mirror := range mirrors {
		mirrorRef, ok := buildRuntimeMirroredImageReference(image, mirror)
		if !ok || mirrorRef == image {
			continue
		}
		lastAttemptError := error(nil)
		for attempt := 1; attempt <= runtimeMirrorRetryCount+1; attempt++ {
			if attempt == 1 {
				logf(fmt.Sprintf("docker runtime mirror pull started: %s via %s", image, mirrorRef))
			} else {
				logf(fmt.Sprintf("docker runtime mirror pull retry %d/%d started: %s via %s", attempt-1, runtimeMirrorRetryCount, image, mirrorRef))
			}
			output, err := pullRuntimeImageWithTimeout(ctx, client, mirrorRef, pullTimeout)
			if err != nil {
				lastAttemptError = err
				logf(fmt.Sprintf("docker runtime mirror pull failed: %s", err.Error()))
				continue
			}
			logRuntimePullOutput(logf, output)
			if _, err := client.ImageTag(ctx, mirrorRef, image); err != nil {
				lastAttemptError = fmt.Errorf("tag %s -> %s: %v", mirrorRef, image, err)
				logf(fmt.Sprintf("docker runtime mirror tag failed: %s", err.Error()))
				continue
			}
			logf(fmt.Sprintf("docker runtime mirror pull succeeded: %s via %s", image, mirrorRef))
			return nil
		}
		if lastAttemptError != nil {
			mirrorErrors = append(mirrorErrors, fmt.Sprintf("%s: %v", mirrorRef, lastAttemptError))
		}
	}
	if len(mirrorErrors) == 0 {
		return fmt.Errorf("image pull failed for %s", image)
	}
	return fmt.Errorf("image pull failed for %s; mirror attempts failed: %s", image, strings.Join(mirrorErrors, "; "))
}

func pullRuntimeImageWithTimeout(ctx context.Context, client *docker.Client, image string, timeout time.Duration) (string, error) {
	if timeout <= 0 {
		timeout = runtimeImagePullTimeout
	}
	pullCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	output, err := client.ImagePull(pullCtx, image)
	if err != nil {
		if runtimePullTimedOut(err) || pullCtx.Err() == context.DeadlineExceeded {
			return "", fmt.Errorf("timed out pulling image %s after %s", image, timeout)
		}
		return "", err
	}
	return output, nil
}

func runtimePullTimedOut(err error) bool {
	return err == context.DeadlineExceeded || err == context.Canceled || strings.Contains(strings.ToLower(err.Error()), "deadline exceeded")
}

func logRuntimePullOutput(logf func(string), output string) {
	for _, rawLine := range strings.Split(output, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			continue
		}
		logf("docker runtime pull: " + line)
	}
}

func extractRuntimeComposeImageReferences(raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}

	var doc map[string]any
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("parse compose for runtime image pull: %w", err)
	}

	rawServices, ok := doc["services"]
	if !ok {
		return nil, nil
	}
	services, ok := rawServices.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("parse compose for runtime image pull: services must be a map")
	}

	imageSet := make(map[string]struct{})
	for _, rawService := range services {
		service, ok := rawService.(map[string]any)
		if !ok {
			continue
		}
		image := strings.TrimSpace(fmt.Sprint(service["image"]))
		if image == "" || image == "<nil>" {
			continue
		}
		imageSet[image] = struct{}{}
	}

	images := make([]string, 0, len(imageSet))
	for image := range imageSet {
		images = append(images, image)
	}
	sort.Strings(images)
	return images, nil
}

func loadRuntimeDockerMirrors(app core.App) []string {
	if app == nil {
		return nil
	}
	group, _ := sysconfig.GetGroup(app, "docker", "mirror", settingsschema.DefaultGroup("docker", "mirror"))
	rawMirrors, _ := group["mirrors"].([]any)
	if len(rawMirrors) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(rawMirrors))
	mirrors := make([]string, 0, len(rawMirrors))
	for _, rawMirror := range rawMirrors {
		mirror := strings.TrimSpace(fmt.Sprint(rawMirror))
		mirror = strings.TrimPrefix(strings.TrimPrefix(mirror, "https://"), "http://")
		mirror = strings.TrimSuffix(mirror, "/")
		if mirror == "" {
			continue
		}
		if _, ok := seen[mirror]; ok {
			continue
		}
		seen[mirror] = struct{}{}
		mirrors = append(mirrors, mirror)
	}
	return mirrors
}

func buildRuntimeMirroredImageReference(image string, mirror string) (string, bool) {
	trimmedImage := strings.TrimSpace(image)
	trimmedMirror := strings.TrimSpace(mirror)
	if trimmedImage == "" || trimmedMirror == "" {
		return "", false
	}

	namePart := trimmedImage
	suffix := ""
	if index := strings.Index(trimmedImage, "@"); index >= 0 {
		namePart = trimmedImage[:index]
		suffix = trimmedImage[index:]
	} else if index := strings.LastIndex(trimmedImage, ":"); index > strings.LastIndex(trimmedImage, "/") {
		namePart = trimmedImage[:index]
		suffix = trimmedImage[index:]
	}

	segments := strings.Split(namePart, "/")
	if len(segments) == 0 {
		return "", false
	}

	registry := ""
	repository := namePart
	first := segments[0]
	if strings.Contains(first, ".") || strings.Contains(first, ":") || first == "localhost" {
		registry = first
		repository = strings.Join(segments[1:], "/")
	}
	if repository == "" {
		return "", false
	}
	if registry == "" && !strings.Contains(repository, "/") {
		repository = "library/" + repository
	}

	if registry != "" {
		return trimmedMirror + "/" + registry + "/" + repository + suffix, true
	}
	return trimmedMirror + "/" + repository + suffix, true
}

func RunDeploymentHealthCheck(ctx context.Context, client interface {
	Exec(context.Context, ...string) (string, error)
}, projectDir string) error {
	composeFile := projectDir + "/docker-compose.yml"
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		attemptCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		output, err := client.Exec(attemptCtx, "compose", "-f", composeFile, "ps", "--status", "running", "-q")
		cancel()
		if err == nil && strings.TrimSpace(output) != "" {
			return nil
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("no running services reported")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(3 * time.Second):
		}
	}
	return lastErr
}
