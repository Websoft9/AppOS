package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
	"github.com/websoft9/appos/backend/domain/dockerops"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/software"
	"github.com/websoft9/appos/backend/infra/collections"
	"github.com/websoft9/appos/backend/infra/docker"
)

const TaskDockerImagePull = "docker:image-pull"

const dockerImagePullOrphanThreshold = 10 * time.Minute

type DockerImagePullPayload struct {
	OperationID string `json:"operation_id"`
	ServerID    string `json:"server_id"`
	ImageName   string `json:"image_name"`
	UserID      string `json:"user_id"`
	UserEmail   string `json:"user_email"`
}

var workerLocalDockerClient = newWorkerLocalDockerClient()

func newWorkerLocalDockerClient() *docker.Client {
	exec := docker.NewLocalExecutor("")
	if os.Getuid() != 0 {
		exec.SudoEnabled = true
	}
	return docker.New(exec)
}

func NewDockerImagePullTask(operationID, serverID, imageName, userID, userEmail string) (*asynq.Task, error) {
	if strings.TrimSpace(operationID) == "" {
		return nil, fmt.Errorf("operation_id is required")
	}
	if strings.TrimSpace(serverID) == "" {
		return nil, fmt.Errorf("server_id is required")
	}
	if strings.TrimSpace(imageName) == "" {
		return nil, fmt.Errorf("image_name is required")
	}
	payload, err := json.Marshal(DockerImagePullPayload{
		OperationID: operationID,
		ServerID:    serverID,
		ImageName:   strings.TrimSpace(imageName),
		UserID:      userID,
		UserEmail:   userEmail,
	})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskDockerImagePull, payload), nil
}

func EnqueueDockerImagePull(client *asynq.Client, operationID, serverID, imageName, userID, userEmail string) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewDockerImagePullTask(operationID, serverID, imageName, userID, userEmail)
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

func NormalizeDockerImageReference(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func PrepareDockerImagePullOperation(app core.App, serverID, imageName string) (*core.Record, error) {
	if strings.TrimSpace(serverID) == "" {
		return nil, fmt.Errorf("server_id is required")
	}
	if strings.TrimSpace(imageName) == "" {
		return nil, fmt.Errorf("image_name is required")
	}
	col, err := app.FindCollectionByNameOrId(collections.DockerImagePullOperations)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(col)
	record.Set("server_id", strings.TrimSpace(serverID))
	record.Set("image_name", strings.TrimSpace(imageName))
	record.Set("normalized_name", NormalizeDockerImageReference(imageName))
	record.Set("phase", string(software.OperationPhaseAccepted))
	record.Set("terminal_status", string(software.TerminalStatusNone))
	record.Set("output", fmt.Sprintf("Pull accepted for %s.", strings.TrimSpace(imageName)))
	if err := app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}

func FindInFlightDockerImagePullOperation(app core.App, serverID, normalizedName string) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId(collections.DockerImagePullOperations)
	if err != nil {
		return nil, nil
	}
	records, err := app.FindRecordsByFilter(
		col,
		fmt.Sprintf("server_id = '%s' && normalized_name = '%s' && terminal_status = '%s'",
			escapePBFilterValue(strings.TrimSpace(serverID)),
			escapePBFilterValue(strings.TrimSpace(normalizedName)),
			escapePBFilterValue(string(software.TerminalStatusNone))),
		"-created",
		1,
		0,
	)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}
	return records[0], nil
}

func (w *Worker) handleDockerImagePull(ctx context.Context, t *asynq.Task) error {
	var payload DockerImagePullPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("parse docker image pull payload: %w", err)
	}
	if strings.TrimSpace(payload.OperationID) == "" || strings.TrimSpace(payload.ServerID) == "" || strings.TrimSpace(payload.ImageName) == "" {
		return fmt.Errorf("docker image pull payload missing required fields")
	}
	record, err := w.app.FindRecordById(collections.DockerImagePullOperations, payload.OperationID)
	if err != nil {
		return fmt.Errorf("load docker image pull operation %q: %w", payload.OperationID, err)
	}
	if record.GetString("server_id") != payload.ServerID {
		return fmt.Errorf("docker image pull operation %q does not match server", payload.OperationID)
	}

	appendDockerImagePullOutput(record, fmt.Sprintf("Starting docker pull %s...", payload.ImageName))
	record.Set("phase", string(software.OperationPhaseExecuting))
	if err := w.app.Save(record); err != nil {
		return fmt.Errorf("save docker image pull operation start: %w", err)
	}

	client, err := servers.NewDockerClient(w.app, payload.ServerID, workerLocalDockerClient)
	if err != nil {
		markDockerImagePullFailed(record, software.OperationPhaseExecuting, fmt.Sprintf("resolve docker client: %v", err))
		_ = w.app.Save(record)
		return nil
	}
	client.SetProxyEnv(loadWorkerDockerProxyEnv(w.app))

	output, pullErr := client.ImagePull(ctx, payload.ImageName)
	if pullErr != nil {
		markDockerImagePullFailed(record, software.OperationPhaseExecuting, pullErr.Error())
		appendDockerImagePullOutput(record, fmt.Sprintf("Pull failed: %v", pullErr))
		_ = w.app.Save(record)
		return nil
	}

	appendDockerImagePullOutput(record, output)
	record.Set("phase", string(software.OperationPhaseSucceeded))
	record.Set("terminal_status", string(software.TerminalStatusSuccess))
	if err := w.app.Save(record); err != nil {
		return fmt.Errorf("save docker image pull operation success: %w", err)
	}
	dockerops.InvalidateImageListCache(dockerops.ImageListCacheKey(payload.ServerID, client.Host()))
	return nil
}

func (w *Worker) recoverOrphanedDockerImagePullOperations() error {
	col, err := w.app.FindCollectionByNameOrId(collections.DockerImagePullOperations)
	if err != nil {
		return nil
	}
	records, err := w.app.FindRecordsByFilter(
		col,
		fmt.Sprintf("terminal_status = '%s'", escapePBFilterValue(string(software.TerminalStatusNone))),
		"-created",
		200,
		0,
	)
	if err != nil {
		return err
	}
	for _, record := range records {
		updatedAt := record.GetDateTime("updated").Time()
		if updatedAt.IsZero() || time.Since(updatedAt) < dockerImagePullOrphanThreshold {
			continue
		}
		markDockerImagePullFailed(record, software.OperationPhase(record.GetString("phase")), "operation orphaned after worker restart")
		appendDockerImagePullOutput(record, "Operation marked failed because it was stale after worker restart.")
		if err := w.app.Save(record); err != nil {
			continue
		}
	}
	return nil
}

func markDockerImagePullFailed(record *core.Record, failurePhase software.OperationPhase, reason string) {
	record.Set("phase", string(software.OperationPhaseFailed))
	record.Set("terminal_status", string(software.TerminalStatusFailed))
	record.Set("failure_reason", strings.TrimSpace(reason))
	if failurePhase != "" {
		record.Set("failure_phase", string(failurePhase))
	}
}

func appendDockerImagePullOutput(record *core.Record, line string) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return
	}
	current := strings.TrimSpace(record.GetString("output"))
	if current == "" {
		record.Set("output", trimmed)
		return
	}
	record.Set("output", current+"\n"+trimmed)
}

func loadWorkerDockerProxyEnv(app core.App) map[string]string {
	group, _ := sysconfig.GetGroup(
		app,
		"proxy",
		"network",
		settingscatalog.DefaultGroup("proxy", "network"),
	)
	if group == nil {
		return nil
	}
	httpProxy := strings.TrimSpace(sysconfig.String(group, "http_proxy", ""))
	httpsProxy := strings.TrimSpace(sysconfig.String(group, "https_proxy", ""))
	noProxy := strings.TrimSpace(sysconfig.String(group, "no_proxy", ""))
	if httpProxy == "" && httpsProxy == "" && noProxy == "" {
		return nil
	}
	env := map[string]string{}
	if httpProxy != "" {
		env["HTTP_PROXY"] = httpProxy
		env["http_proxy"] = httpProxy
	}
	if httpsProxy != "" {
		env["HTTPS_PROXY"] = httpsProxy
		env["https_proxy"] = httpsProxy
	}
	if noProxy != "" {
		env["NO_PROXY"] = noProxy
		env["no_proxy"] = noProxy
	}
	return env
}
