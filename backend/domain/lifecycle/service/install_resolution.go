package service

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sharedenv"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/lifecycle/model"
	"github.com/websoft9/appos/backend/domain/secrets"
	"gopkg.in/yaml.v3"
)

type ExposureIntent struct {
	ExposureType  string
	IsPrimary     bool
	Domain        string
	Path          string
	TargetPort    int
	CertificateID string
	Notes         string
}

func (intent *ExposureIntent) ToMap() map[string]any {
	if intent == nil {
		return nil
	}
	result := map[string]any{
		"exposure_type": intent.ExposureType,
		"is_primary":    intent.IsPrimary,
	}
	if intent.Domain != "" {
		result["domain"] = intent.Domain
	}
	if intent.Path != "" {
		result["path"] = intent.Path
	}
	if intent.TargetPort > 0 {
		result["target_port"] = intent.TargetPort
	}
	if intent.CertificateID != "" {
		result["certificate_id"] = intent.CertificateID
	}
	if intent.Notes != "" {
		result["notes"] = intent.Notes
	}
	return result
}

type NormalizedInstallSpec struct {
	ServerID           string
	ProjectName        string
	ComposeProjectName string
	ProjectDir         string
	RenderedCompose    string
	OperationType      string
	Source             string
	Adapter            string
	ResolvedEnv        map[string]any
	ExposureIntent     *ExposureIntent
	Metadata           map[string]any
	SourceBuild        *InstallSourceBuildInput
	SecretRefs         []string
}

type InstallRuntimeEnvInput struct {
	Name            string
	Kind            string
	GeneratorMethod string
	SetID           string
	VarID           string
	SourceKey       string
	SecretRef       string
}

func (input InstallRuntimeEnvInput) ToMap() map[string]any {
	result := map[string]any{}
	if input.Name != "" {
		result["name"] = input.Name
	}
	if input.Kind != "" {
		result["kind"] = input.Kind
	}
	if input.GeneratorMethod != "" {
		result["generator_method"] = input.GeneratorMethod
	}
	if input.SetID != "" {
		result["set_id"] = input.SetID
	}
	if input.VarID != "" {
		result["var_id"] = input.VarID
	}
	if input.SourceKey != "" {
		result["source_key"] = input.SourceKey
	}
	if input.SecretRef != "" {
		result["secret_ref"] = input.SecretRef
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

type InstallRuntimeFileInput struct {
	Kind       string
	Name       string
	SourcePath string
	MountPath  string
	Uploaded   bool
}

func (input InstallRuntimeFileInput) ToMap() map[string]any {
	result := map[string]any{}
	if input.Kind != "" {
		result["kind"] = input.Kind
	}
	if input.Name != "" {
		result["name"] = input.Name
	}
	if input.SourcePath != "" {
		result["source_path"] = input.SourcePath
	}
	if input.MountPath != "" {
		result["mount_path"] = input.MountPath
	}
	if input.Uploaded {
		result["uploaded"] = true
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

type InstallRuntimeInputs struct {
	Env   []InstallRuntimeEnvInput
	Files []InstallRuntimeFileInput
}

func (inputs *InstallRuntimeInputs) ToMap() map[string]any {
	if inputs == nil {
		return nil
	}
	result := map[string]any{}
	if len(inputs.Env) > 0 {
		env := make([]any, 0, len(inputs.Env))
		for _, item := range inputs.Env {
			if normalized := item.ToMap(); len(normalized) > 0 {
				env = append(env, normalized)
			}
		}
		if len(env) > 0 {
			result["env"] = env
		}
	}
	if len(inputs.Files) > 0 {
		files := make([]any, 0, len(inputs.Files))
		for _, item := range inputs.Files {
			if normalized := item.ToMap(); len(normalized) > 0 {
				files = append(files, normalized)
			}
		}
		if len(files) > 0 {
			result["files"] = files
		}
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

type InstallArtifactPublication struct {
	Mode                 string
	TargetRef            string
	CredentialRef        string
	ImageName            string
	ImageTag             string
	ExpectedArtifactKind string
}

func (publication *InstallArtifactPublication) ToMap() map[string]any {
	if publication == nil {
		return nil
	}
	result := map[string]any{}
	if publication.Mode != "" {
		result["mode"] = publication.Mode
	}
	if publication.TargetRef != "" {
		result["target_ref"] = publication.TargetRef
	}
	if publication.CredentialRef != "" {
		result["credential_ref"] = publication.CredentialRef
	}
	if publication.ImageName != "" {
		result["image_name"] = publication.ImageName
	}
	if publication.ImageTag != "" {
		result["image_tag"] = publication.ImageTag
	}
	if publication.ExpectedArtifactKind != "" {
		result["expected_artifact_kind"] = publication.ExpectedArtifactKind
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

type InstallSourceBuildInput struct {
	SourceKind          string
	SourceRef           string
	SourceRevision      string
	WorkspaceRef        string
	BuilderStrategy     string
	BuilderInputs       map[string]any
	ArtifactPublication *InstallArtifactPublication
	DeployInputs        map[string]any
	ReleaseMetadata     map[string]any
}

func (input *InstallSourceBuildInput) ToMap() map[string]any {
	if input == nil {
		return nil
	}
	result := map[string]any{}
	if input.SourceKind != "" {
		result["source_kind"] = input.SourceKind
	}
	if input.SourceRef != "" {
		result["source_ref"] = input.SourceRef
	}
	if input.SourceRevision != "" {
		result["source_revision"] = input.SourceRevision
	}
	if input.WorkspaceRef != "" {
		result["workspace_ref"] = input.WorkspaceRef
	}
	if input.BuilderStrategy != "" {
		result["builder_strategy"] = input.BuilderStrategy
	}
	if len(input.BuilderInputs) > 0 {
		result["builder_inputs"] = cloneMap(input.BuilderInputs)
	}
	if publication := input.ArtifactPublication.ToMap(); len(publication) > 0 {
		result["artifact_publication"] = publication
	}
	if len(input.DeployInputs) > 0 {
		result["deploy_inputs"] = cloneMap(input.DeployInputs)
	}
	if len(input.ReleaseMetadata) > 0 {
		result["release_metadata"] = cloneMap(input.ReleaseMetadata)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

type InstallCandidateKind string

const (
	InstallCandidateKindManualCompose    InstallCandidateKind = "manual-compose"
	InstallCandidateKindGitCompose       InstallCandidateKind = "git-compose"
	InstallCandidateKindStorePrefill     InstallCandidateKind = "store-prefill"
	InstallCandidateKindInstalledPrefill InstallCandidateKind = "installed-prefill"
	InstallCandidateKindDockerCommand    InstallCandidateKind = "docker-command"
	InstallCandidateKindInstallScript    InstallCandidateKind = "install-script"
)

type InstallCandidateInput struct {
	Kind           InstallCandidateKind
	Source         string
	Adapter        string
	OriginContext  map[string]any
	PrefillContext map[string]any
	Payload        map[string]any
}

func (spec NormalizedInstallSpec) OperationSpec() map[string]any {
	result := map[string]any{
		"server_id":            spec.ServerID,
		"project_name":         spec.ProjectName,
		"source":               spec.Source,
		"adapter":              spec.Adapter,
		"compose_project_name": spec.ComposeProjectName,
		"project_dir":          spec.ProjectDir,
		"rendered_compose":     spec.RenderedCompose,
		"operation_type":       spec.OperationType,
	}
	if len(spec.ResolvedEnv) > 0 {
		result["resolved_env"] = spec.ResolvedEnv
	}
	if spec.ExposureIntent != nil {
		result["exposure_intent"] = spec.ExposureIntent.ToMap()
	}
	if len(spec.Metadata) > 0 {
		result["metadata"] = spec.Metadata
	}
	if spec.SourceBuild != nil {
		result["mode"] = "source-build"
		result["source_build"] = spec.SourceBuild.ToMap()
	}
	if len(spec.SecretRefs) > 0 {
		result["secret_refs"] = append([]string(nil), spec.SecretRefs...)
	}
	return result
}

type InstallResolutionRequest struct {
	ServerID           string
	ProjectName        string
	Compose            string
	OperationType      string
	Source             string
	Adapter            string
	ProjectDir         string
	ComposeProjectName string
	UserID             string
	Env                map[string]any
	ExposureIntent     *ExposureIntent
	Metadata           map[string]any
	RuntimeInputs      *InstallRuntimeInputs
	SourceBuild        *InstallSourceBuildInput
}

type InstallIngressOptions struct {
	OperationType      string
	ProjectDir         string
	ComposeProjectName string
	UserID             string
	Env                map[string]any
	ExposureIntent     *ExposureIntent
	Metadata           map[string]any
	RuntimeInputs      *InstallRuntimeInputs
	SourceBuild        *InstallSourceBuildInput
}

func BuildInstallIngressOptionsFromRaw(userID string, operationType string, projectDir string, composeProjectName string, env map[string]any, rawExposure map[string]any, rawMetadata map[string]any, rawRuntimeInputs map[string]any, rawSourceBuild map[string]any, appRequiredDiskBytes int64, appRequiredDiskGiB float64) InstallIngressOptions {
	return InstallIngressOptions{
		OperationType:      strings.TrimSpace(operationType),
		ProjectDir:         strings.TrimSpace(projectDir),
		ComposeProjectName: strings.TrimSpace(composeProjectName),
		UserID:             strings.TrimSpace(userID),
		Env:                cloneMap(env),
		ExposureIntent:     ParseExposureIntentMap(rawExposure),
		Metadata:           NormalizeInstallMetadata(rawMetadata, appRequiredDiskBytes, appRequiredDiskGiB),
		RuntimeInputs:      NormalizeInstallRuntimeInputs(rawRuntimeInputs),
		SourceBuild:        NormalizeInstallSourceBuild(rawSourceBuild),
	}
}

func BuildInstallResolutionRequest(serverID string, projectName string, compose string, source string, adapter string, options InstallIngressOptions) InstallResolutionRequest {
	return InstallResolutionRequest{
		ServerID:           serverID,
		ProjectName:        projectName,
		Compose:            compose,
		OperationType:      options.OperationType,
		Source:             source,
		Adapter:            adapter,
		ProjectDir:         options.ProjectDir,
		ComposeProjectName: options.ComposeProjectName,
		UserID:             strings.TrimSpace(options.UserID),
		Env:                cloneMap(options.Env),
		ExposureIntent:     cloneExposureIntent(options.ExposureIntent),
		Metadata:           cloneMap(options.Metadata),
		RuntimeInputs:      cloneRuntimeInputs(options.RuntimeInputs),
		SourceBuild:        cloneSourceBuild(options.SourceBuild),
	}
}

func BuildManualComposeInstallResolutionRequest(request deploy.ManualComposeRequest, options InstallIngressOptions) InstallResolutionRequest {
	adapter := deploy.AdapterManualCompose
	candidateKind := InstallCandidateKindManualCompose
	if options.SourceBuild != nil {
		adapter = deploy.AdapterSourceBuild
		candidateKind = InstallCandidateKindInstallScript
	}
	options.Metadata = applyInstallCandidateMetadata(options.Metadata, candidateKind, deploy.SourceManualOps, adapter, nil)
	return BuildInstallResolutionRequest(request.ServerID, request.ProjectName, request.Compose, deploy.SourceManualOps, adapter, options)
}

func BuildGitComposeInstallResolutionRequest(request deploy.GitComposeRequest, compose string, rawURL string, options InstallIngressOptions) InstallResolutionRequest {
	projectName := strings.TrimSpace(request.ProjectName)
	if projectName == "" {
		projectName = deriveGitComposeProjectName(request.RepositoryURL, request.ComposePath, rawURL)
	}
	options.Metadata = MergeMetadata(gitComposeMetadata(request, rawURL), options.Metadata)
	options.Metadata = applyInstallCandidateMetadata(options.Metadata, InstallCandidateKindGitCompose, deploy.SourceGitOps, deploy.AdapterGitCompose, gitComposeMetadata(request, rawURL))
	return BuildInstallResolutionRequest(request.ServerID, projectName, compose, deploy.SourceGitOps, deploy.AdapterGitCompose, options)
}

func GitComposeAuditDetail(request deploy.GitComposeRequest, rawURL string) map[string]any {
	return gitComposeMetadata(request, rawURL)
}

func ParseExposureIntentMap(raw map[string]any) *ExposureIntent {
	if len(raw) == 0 {
		return nil
	}
	intent := &ExposureIntent{
		ExposureType:  mapString(raw, "exposure_type"),
		IsPrimary:     true,
		Domain:        mapString(raw, "domain"),
		Path:          mapString(raw, "path"),
		TargetPort:    mapInt(raw, "target_port"),
		CertificateID: mapString(raw, "certificate_id"),
		Notes:         mapString(raw, "notes"),
	}
	if _, exists := raw["is_primary"]; exists {
		intent.IsPrimary = mapBool(raw, "is_primary")
	}
	return intent
}

func NormalizeInstallMetadata(raw map[string]any, appRequiredDiskBytes int64, appRequiredDiskGiB float64) map[string]any {
	result := cloneMap(raw)
	if result == nil {
		result = map[string]any{}
	}
	if appRequiredDiskBytes > 0 {
		result["app_required_disk_bytes"] = appRequiredDiskBytes
	}
	if appRequiredDiskGiB > 0 {
		result["app_required_disk_bytes"] = int64(appRequiredDiskGiB * 1024 * 1024 * 1024)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func MergeMetadata(base map[string]any, extra map[string]any) map[string]any {
	if len(base) == 0 && len(extra) == 0 {
		return nil
	}
	merged := map[string]any{}
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range extra {
		merged[key] = value
	}
	if len(merged) == 0 {
		return nil
	}
	return merged
}

func NormalizeInstallRuntimeInputs(raw map[string]any) *InstallRuntimeInputs {
	if len(raw) == 0 {
		return nil
	}
	result := &InstallRuntimeInputs{}
	if env := mapSlice(raw, "env"); len(env) > 0 {
		result.Env = normalizeRuntimeEnvInputs(env)
	}
	if files := mapSlice(raw, "files"); len(files) > 0 {
		result.Files = normalizeRuntimeFileInputs(files)
	}
	if len(result.Env) == 0 && len(result.Files) == 0 {
		return nil
	}
	return result
}

func NormalizeInstallSourceBuild(raw map[string]any) *InstallSourceBuildInput {
	if len(raw) == 0 {
		return nil
	}
	result := &InstallSourceBuildInput{
		SourceKind:      mapString(raw, "source_kind"),
		SourceRef:       mapString(raw, "source_ref"),
		SourceRevision:  mapString(raw, "source_revision"),
		WorkspaceRef:    mapString(raw, "workspace_ref"),
		BuilderStrategy: mapString(raw, "builder_strategy"),
		BuilderInputs:   cloneMap(mapMap(raw, "builder_inputs")),
		DeployInputs:    cloneMap(mapMap(raw, "deploy_inputs")),
		ReleaseMetadata: cloneMap(mapMap(raw, "release_metadata")),
	}
	if publication := mapMap(raw, "artifact_publication"); len(publication) > 0 {
		mode := mapString(publication, "mode")
		if mode == "" {
			mode = "local"
		}
		result.ArtifactPublication = &InstallArtifactPublication{
			Mode:                 mode,
			TargetRef:            mapString(publication, "target_ref"),
			CredentialRef:        mapString(publication, "credential_ref"),
			ImageName:            mapString(publication, "image_name"),
			ImageTag:             mapString(publication, "image_tag"),
			ExpectedArtifactKind: mapString(publication, "expected_artifact_kind"),
		}
	}
	if result.ToMap() == nil {
		return nil
	}
	return result
}

func ResolveInstallFromCompose(app core.App, request InstallResolutionRequest) (NormalizedInstallSpec, error) {
	if err := deploy.ValidateManualCompose(request.Compose); err != nil {
		return NormalizedInstallSpec{}, err
	}

	normalizedProjectName := deploy.NormalizeProjectName(request.ProjectName)
	if normalizedProjectName == "" {
		normalizedProjectName = "app"
	}
	composeProjectName := normalizedProjectName
	if value := strings.TrimSpace(request.ComposeProjectName); value != "" {
		composeProjectName = value
	}
	projectDir := filepath.Join("/appos/data/apps/operations", normalizedProjectName)
	if value := strings.TrimSpace(request.ProjectDir); value != "" {
		projectDir = value
	}
	operationType := strings.TrimSpace(request.OperationType)
	if operationType == "" {
		operationType = string(model.OperationTypeInstall)
	}
	resolvedEnv, secretRefs, normalizedRuntimeInputs, err := normalizeInstallEnv(app, request.Env, request.RuntimeInputs, request.UserID)
	if err != nil {
		return NormalizedInstallSpec{}, err
	}
	if err := validateRuntimeFileInputs(normalizedRuntimeInputs); err != nil {
		return NormalizedInstallSpec{}, err
	}
	normalizedSourceBuild := cloneSourceBuild(request.SourceBuild)
	if err := validateSourceBuildInput(normalizedSourceBuild); err != nil {
		return NormalizedInstallSpec{}, err
	}
	exposureIntent, err := normalizeExposureIntent(request.ExposureIntent)
	if err != nil {
		return NormalizedInstallSpec{}, err
	}
	metadata := cloneMap(request.Metadata)
	if normalizedRuntimeInputs != nil {
		metadata = MergeMetadata(metadata, map[string]any{"runtime_inputs": normalizedRuntimeInputs.ToMap()})
	}
	renderedCompose := request.Compose
	if normalizedSourceBuild != nil {
		imageRef := placeholderSourceBuildImageRef(normalizedSourceBuild)
		renderedCompose, err = renderSourceBuildCompose(request.Compose, imageRef, normalizedSourceBuild.DeployInputs)
		if err != nil {
			return NormalizedInstallSpec{}, err
		}
	}
	return NormalizedInstallSpec{
		ServerID:           normalizeServerID(request.ServerID),
		ProjectName:        normalizedProjectName,
		ComposeProjectName: composeProjectName,
		ProjectDir:         projectDir,
		RenderedCompose:    renderedCompose,
		OperationType:      operationType,
		Source:             request.Source,
		Adapter:            request.Adapter,
		ResolvedEnv:        resolvedEnv,
		ExposureIntent:     exposureIntent,
		Metadata:           metadata,
		SourceBuild:        normalizedSourceBuild,
		SecretRefs:         secretRefs,
	}, nil
}

func placeholderSourceBuildImageRef(sourceBuild *InstallSourceBuildInput) string {
	if sourceBuild == nil || sourceBuild.ArtifactPublication == nil {
		return ""
	}
	return sourceBuild.ArtifactPublication.ImageName + ":" + normalizedSourceBuildImageTag(sourceBuild.ArtifactPublication.ImageTag)
}

func normalizedSourceBuildImageTag(tag string) string {
	trimmed := strings.TrimSpace(tag)
	if trimmed == "" {
		return "candidate"
	}
	return trimmed
}

func renderSourceBuildCompose(rawCompose string, imageRef string, deployInputs map[string]any) (string, error) {
	if strings.TrimSpace(rawCompose) == "" || strings.TrimSpace(imageRef) == "" {
		return rawCompose, nil
	}
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(rawCompose), &doc); err != nil {
		return "", fmt.Errorf("invalid compose yaml: %w", err)
	}
	services, ok := doc["services"].(map[string]any)
	if !ok || len(services) == 0 {
		return "", fmt.Errorf("compose must contain services")
	}
	targetService := strings.TrimSpace(mapString(deployInputs, "service_name"))
	if targetService == "" {
		targetService = strings.TrimSpace(mapString(deployInputs, "target_service"))
	}
	if targetService == "" {
		if len(services) != 1 {
			return "", fmt.Errorf("source_build.deploy_inputs.service_name is required for multi-service compose")
		}
		for name := range services {
			targetService = strings.TrimSpace(name)
		}
	}
	targetValue, ok := services[targetService]
	if !ok {
		return "", fmt.Errorf("source_build target service %q not found in compose", targetService)
	}
	serviceMap, ok := targetValue.(map[string]any)
	if !ok {
		return "", fmt.Errorf("compose service %q must be a map", targetService)
	}
	serviceMap["image"] = imageRef
	delete(serviceMap, "build")
	services[targetService] = serviceMap
	doc["services"] = services
	encoded, err := yaml.Marshal(doc)
	if err != nil {
		return "", fmt.Errorf("marshal source-build compose: %w", err)
	}
	return string(encoded), nil
}

func normalizeInstallEnv(app core.App, env map[string]any, runtimeInputs *InstallRuntimeInputs, userID string) (map[string]any, []string, *InstallRuntimeInputs, error) {
	if len(env) == 0 && (runtimeInputs == nil || len(runtimeInputs.Env) == 0) {
		return nil, nil, runtimeInputs, nil
	}
	resolved := make(map[string]any, len(env))
	secretRefs := make([]string, 0)
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" {
			return nil, nil, nil, fmt.Errorf("env keys must not be empty")
		}
		value, err := normalizeEnvValue(app, env[key], userID)
		if err != nil {
			return nil, nil, nil, fmt.Errorf("env %s: %w", normalizedKey, err)
		}
		resolved[normalizedKey] = value
		if stringValue, ok := value.(string); ok && secrets.IsSecretRef(stringValue) {
			secretRefs = append(secretRefs, stringValue)
		}
	}
	normalizedRuntimeInputs, err := resolveRuntimeEnvInputs(app, runtimeInputs, resolved, userID)
	if err != nil {
		return nil, nil, nil, err
	}
	secretRefs = append(secretRefs, collectRuntimeSecretRefs(normalizedRuntimeInputs)...)
	secretRefs = uniqueStrings(secretRefs)
	if len(resolved) == 0 {
		resolved = nil
	}
	return resolved, secretRefs, normalizedRuntimeInputs, nil
}

func normalizeEnvValue(app core.App, value any, userID string) (any, error) {
	switch typed := value.(type) {
	case nil:
		return "", nil
	case string:
		if secretID, ok := secrets.ExtractSecretID(typed); ok {
			if app == nil {
				return nil, fmt.Errorf("secret validation requires app context")
			}
			if err := secrets.ValidateRef(app, secretID, strings.TrimSpace(userID)); err != nil {
				return nil, err
			}
		}
		return typed, nil
	case bool:
		if typed {
			return "true", nil
		}
		return "false", nil
	case float64:
		return fmt.Sprintf("%v", typed), nil
	case float32:
		return fmt.Sprintf("%v", typed), nil
	case int:
		return fmt.Sprintf("%d", typed), nil
	case int32:
		return fmt.Sprintf("%d", typed), nil
	case int64:
		return fmt.Sprintf("%d", typed), nil
	default:
		return nil, fmt.Errorf("unsupported env value type %T", value)
	}
}

func normalizeExposureIntent(intent *ExposureIntent) (*ExposureIntent, error) {
	if intent == nil {
		return nil, nil
	}
	normalized := &ExposureIntent{
		ExposureType:  strings.TrimSpace(intent.ExposureType),
		IsPrimary:     intent.IsPrimary,
		Domain:        strings.TrimSpace(intent.Domain),
		Path:          strings.TrimSpace(intent.Path),
		TargetPort:    intent.TargetPort,
		CertificateID: strings.TrimSpace(intent.CertificateID),
		Notes:         strings.TrimSpace(intent.Notes),
	}
	if normalized.ExposureType == "" {
		switch {
		case normalized.Domain != "":
			normalized.ExposureType = "domain"
		case normalized.Path != "":
			normalized.ExposureType = "path"
		case normalized.TargetPort > 0:
			normalized.ExposureType = "port"
		default:
			return nil, nil
		}
	}
	if normalized.TargetPort < 0 {
		return nil, fmt.Errorf("target_port must be greater than or equal to zero")
	}
	switch normalized.ExposureType {
	case "domain":
		if normalized.Domain == "" {
			return nil, fmt.Errorf("domain exposure requires domain")
		}
	case "path":
		if normalized.Path == "" {
			return nil, fmt.Errorf("path exposure requires path")
		}
	case "port":
		if normalized.TargetPort <= 0 {
			return nil, fmt.Errorf("port exposure requires target_port")
		}
	case "internal_only":
	default:
		return nil, fmt.Errorf("unsupported exposure_type %q", normalized.ExposureType)
	}
	return normalized, nil
}

func normalizeServerID(serverID string) string {
	if strings.TrimSpace(serverID) == "" {
		return "local"
	}
	return strings.TrimSpace(serverID)
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}

func cloneExposureIntent(input *ExposureIntent) *ExposureIntent {
	if input == nil {
		return nil
	}
	cloned := *input
	return &cloned
}

func cloneRuntimeInputs(input *InstallRuntimeInputs) *InstallRuntimeInputs {
	if input == nil {
		return nil
	}
	cloned := &InstallRuntimeInputs{}
	if len(input.Env) > 0 {
		cloned.Env = append([]InstallRuntimeEnvInput(nil), input.Env...)
	}
	if len(input.Files) > 0 {
		cloned.Files = append([]InstallRuntimeFileInput(nil), input.Files...)
	}
	return cloned
}

func cloneSourceBuild(input *InstallSourceBuildInput) *InstallSourceBuildInput {
	if input == nil {
		return nil
	}
	cloned := &InstallSourceBuildInput{
		SourceKind:      input.SourceKind,
		SourceRef:       input.SourceRef,
		SourceRevision:  input.SourceRevision,
		WorkspaceRef:    input.WorkspaceRef,
		BuilderStrategy: input.BuilderStrategy,
		BuilderInputs:   cloneMap(input.BuilderInputs),
		DeployInputs:    cloneMap(input.DeployInputs),
		ReleaseMetadata: cloneMap(input.ReleaseMetadata),
	}
	if input.ArtifactPublication != nil {
		cloned.ArtifactPublication = &InstallArtifactPublication{
			Mode:                 input.ArtifactPublication.Mode,
			TargetRef:            input.ArtifactPublication.TargetRef,
			CredentialRef:        input.ArtifactPublication.CredentialRef,
			ImageName:            input.ArtifactPublication.ImageName,
			ImageTag:             input.ArtifactPublication.ImageTag,
			ExpectedArtifactKind: input.ArtifactPublication.ExpectedArtifactKind,
		}
	}
	return cloned
}

func mapString(input map[string]any, key string) string {
	if input == nil {
		return ""
	}
	value, ok := input[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", value))
	}
}

func mapInt(input map[string]any, key string) int {
	if input == nil {
		return 0
	}
	value, ok := input[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float32:
		return int(typed)
	case float64:
		return int(typed)
	default:
		return 0
	}
}

func mapBool(input map[string]any, key string) bool {
	if input == nil {
		return false
	}
	value, ok := input[key]
	if !ok || value == nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	default:
		return false
	}
}

func gitComposeMetadata(request deploy.GitComposeRequest, rawURL string) map[string]any {
	return map[string]any{
		"repository_url": request.RepositoryURL,
		"ref":            request.Ref,
		"compose_path":   request.ComposePath,
		"raw_url":        rawURL,
	}
}

func applyInstallCandidateMetadata(metadata map[string]any, defaultKind InstallCandidateKind, source string, adapter string, payload map[string]any) map[string]any {
	result := cloneMap(metadata)
	if result == nil {
		result = map[string]any{}
	}

	kind := resolveInstallCandidateKind(result, defaultKind)
	if strings.TrimSpace(string(kind)) != "" {
		result["candidate_kind"] = string(kind)
	}

	originContext := MergeMetadata(
		map[string]any{
			"source":  strings.TrimSpace(source),
			"adapter": strings.TrimSpace(adapter),
		},
		mapMap(result, "origin_context"),
	)
	if len(originContext) > 0 {
		result["origin_context"] = originContext
	}

	prefillContext := mapMap(result, "prefill_context")
	if len(prefillContext) > 0 {
		result["prefill_context"] = prefillContext
	}

	candidatePayload := MergeMetadata(payload, mapMap(result, "candidate_payload"))
	if len(candidatePayload) > 0 {
		result["candidate_payload"] = candidatePayload
	}

	if len(result) == 0 {
		return nil
	}
	return result
}

func resolveInstallCandidateKind(metadata map[string]any, fallback InstallCandidateKind) InstallCandidateKind {
	if metadata != nil {
		if value := mapString(metadata, "candidate_kind"); value != "" {
			return InstallCandidateKind(value)
		}
	}
	return fallback
}

func mapMap(input map[string]any, key string) map[string]any {
	if input == nil {
		return nil
	}
	value, ok := input[key]
	if !ok || value == nil {
		return nil
	}
	typed, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return cloneMap(typed)
}

func mapSlice(input map[string]any, key string) []map[string]any {
	if input == nil {
		return nil
	}
	value, ok := input[key]
	if !ok || value == nil {
		return nil
	}
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		typed, ok := item.(map[string]any)
		if !ok {
			continue
		}
		result = append(result, cloneMap(typed))
	}
	return result
}

func normalizeRuntimeEnvInputs(raw []map[string]any) []InstallRuntimeEnvInput {
	result := make([]InstallRuntimeEnvInput, 0, len(raw))
	for _, item := range raw {
		normalized := InstallRuntimeEnvInput{
			Name:            mapString(item, "name"),
			Kind:            mapString(item, "kind"),
			GeneratorMethod: mapString(item, "generator_method"),
			SetID:           mapString(item, "set_id"),
			VarID:           mapString(item, "var_id"),
			SourceKey:       mapString(item, "source_key"),
		}
		if normalized.Kind == "" || normalized.Name == "" {
			continue
		}
		result = append(result, normalized)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeRuntimeFileInputs(raw []map[string]any) []InstallRuntimeFileInput {
	result := make([]InstallRuntimeFileInput, 0, len(raw))
	for _, item := range raw {
		normalized := InstallRuntimeFileInput{
			Kind:       mapString(item, "kind"),
			Name:       mapString(item, "name"),
			SourcePath: mapString(item, "source_path"),
			MountPath:  mapString(item, "mount_path"),
			Uploaded:   mapBool(item, "uploaded"),
		}
		if normalized.Kind == "" || normalized.Name == "" {
			continue
		}
		if normalized.SourcePath == "" {
			normalized.SourcePath = normalized.Name
		}
		result = append(result, normalized)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func resolveRuntimeEnvInputs(app core.App, runtimeInputs *InstallRuntimeInputs, resolvedEnv map[string]any, userID string) (*InstallRuntimeInputs, error) {
	if runtimeInputs == nil {
		return nil, nil
	}
	normalized := cloneRuntimeInputs(runtimeInputs)
	for index, item := range normalized.Env {
		if item.Kind != "shared-import" {
			continue
		}
		value, secretRef, sourceKey, err := resolveSharedEnvImport(app, item, userID)
		if err != nil {
			return nil, fmt.Errorf("runtime_inputs.env[%d]: %w", index, err)
		}
		if resolvedEnv == nil {
			resolvedEnv = map[string]any{}
		}
		resolvedEnv[item.Name] = value
		normalized.Env[index].SourceKey = sourceKey
		normalized.Env[index].SecretRef = secretRef
	}
	return normalized, nil
}

func validateRuntimeFileInputs(runtimeInputs *InstallRuntimeInputs) error {
	if runtimeInputs == nil || len(runtimeInputs.Files) == 0 {
		return nil
	}
	for index, item := range runtimeInputs.Files {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			return fmt.Errorf("runtime_inputs.files[%d]: name is required", index)
		}
		sourcePath := strings.TrimSpace(item.SourcePath)
		if sourcePath == "" {
			return fmt.Errorf("runtime_inputs.files[%d]: source_path is required", index)
		}
		switch strings.TrimSpace(item.Kind) {
		case "mount-file":
			if strings.TrimSpace(item.MountPath) == "" {
				return fmt.Errorf("runtime_inputs.files[%d]: mount-file requires mount_path", index)
			}
		case "source-package":
			continue
		default:
			return fmt.Errorf("runtime_inputs.files[%d]: unsupported kind %q", index, item.Kind)
		}
	}
	return nil
}

func validateSourceBuildInput(sourceBuild *InstallSourceBuildInput) error {
	if sourceBuild == nil {
		return nil
	}
	if strings.TrimSpace(sourceBuild.SourceKind) == "" {
		return fmt.Errorf("source_build.source_kind is required")
	}
	if strings.TrimSpace(sourceBuild.SourceRef) == "" {
		return fmt.Errorf("source_build.source_ref is required")
	}
	if strings.TrimSpace(sourceBuild.BuilderStrategy) == "" {
		return fmt.Errorf("source_build.builder_strategy is required")
	}
	if sourceBuild.ArtifactPublication == nil {
		return fmt.Errorf("source_build.artifact_publication is required")
	}
	if strings.TrimSpace(sourceBuild.ArtifactPublication.Mode) == "" {
		sourceBuild.ArtifactPublication.Mode = "local"
	}
	if strings.TrimSpace(sourceBuild.ArtifactPublication.ImageName) == "" {
		return fmt.Errorf("source_build.artifact_publication.image_name is required")
	}
	if strings.EqualFold(strings.TrimSpace(sourceBuild.ArtifactPublication.Mode), "push") && strings.TrimSpace(sourceBuild.ArtifactPublication.TargetRef) == "" {
		return fmt.Errorf("source_build.artifact_publication.target_ref is required when mode=push")
	}
	if strings.EqualFold(strings.TrimSpace(sourceBuild.SourceKind), "uploaded-package") && strings.TrimSpace(sourceBuild.WorkspaceRef) == "" {
		return fmt.Errorf("source_build.workspace_ref is required when source_kind=uploaded-package")
	}
	return nil
}

func resolveSharedEnvImport(app core.App, input InstallRuntimeEnvInput, userID string) (any, string, string, error) {
	if app == nil {
		return nil, "", "", fmt.Errorf("shared env resolution requires app context")
	}
	if input.SetID == "" {
		return nil, "", "", fmt.Errorf("shared-import requires set_id")
	}
	if input.VarID == "" && input.SourceKey == "" {
		return nil, "", "", fmt.Errorf("shared-import requires var_id or source_key")
	}
	resolvedVar, err := sharedenv.FindVar(app, sharedenv.VarLookup{
		SetID:     input.SetID,
		VarID:     input.VarID,
		SourceKey: input.SourceKey,
	})
	if err != nil {
		return nil, "", "", err
	}
	sourceKey := strings.TrimSpace(resolvedVar.Key)
	if sourceKey == "" {
		return nil, "", "", fmt.Errorf("shared env variable has empty key")
	}
	if resolvedVar.IsSecret {
		secretID := strings.TrimSpace(resolvedVar.SecretID)
		if secretID == "" {
			return nil, "", "", fmt.Errorf("shared secret env variable missing secret reference")
		}
		if err := secrets.ValidateRef(app, secretID, strings.TrimSpace(userID)); err != nil {
			return nil, "", "", err
		}
		return secrets.SecretRefPrefix + secretID, secrets.SecretRefPrefix + secretID, sourceKey, nil
	}
	return resolvedVar.Value, "", sourceKey, nil
}

func collectRuntimeSecretRefs(inputs *InstallRuntimeInputs) []string {
	if inputs == nil || len(inputs.Env) == 0 {
		return nil
	}
	result := make([]string, 0)
	for _, item := range inputs.Env {
		if strings.TrimSpace(item.SecretRef) != "" {
			result = append(result, item.SecretRef)
		}
	}
	return result
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func deriveGitComposeProjectName(repositoryURL string, composePath string, rawURL string) string {
	value := repositoryURL
	if strings.TrimSpace(value) == "" {
		value = rawURL
	}
	trimmed := strings.Trim(strings.TrimSuffix(strings.TrimSpace(value), ".git"), "/")
	segments := strings.Split(trimmed, "/")
	if len(segments) >= 2 {
		return deploy.NormalizeProjectName(segments[len(segments)-1])
	}
	if base := strings.TrimSuffix(filepath.Base(composePath), filepath.Ext(composePath)); base != "" {
		return deploy.NormalizeProjectName(base)
	}
	return "git-deploy"
}
