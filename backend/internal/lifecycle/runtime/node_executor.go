package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/deploy"
	"github.com/websoft9/appos/backend/internal/docker"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
)

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
		healthCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
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

func ensureDockerClient(executor Executor, current *docker.Client) (*docker.Client, error) {
	if current != nil {
		return current, nil
	}
	return executor.DockerClient()
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