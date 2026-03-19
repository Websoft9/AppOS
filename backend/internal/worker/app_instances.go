package worker

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/deploy"
)

func syncAppInstanceFromDeployment(app core.App, deploymentRecord *core.Record) error {
	if deploymentRecord == nil || deploymentRecord.GetString("status") != deploy.StatusSuccess {
		return nil
	}

	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		return err
	}

	projectDir := deploymentRecord.GetString("project_dir")
	serverID := normalizeAppInstanceServerID(deploymentRecord.GetString("server_id"))
	filter := fmt.Sprintf(`server_id = "%s" && project_dir = "%s"`, serverID, projectDir)
	record, err := app.FindFirstRecordByFilter("app_instances", filter)
	if err != nil || record == nil {
		record = core.NewRecord(col)
	}

	record.Set("deployment_id", deploymentRecord.Id)
	record.Set("server_id", serverID)
	record.Set("name", deploymentRecord.GetString("compose_project_name"))
	record.Set("project_dir", projectDir)
	record.Set("source", deploymentRecord.GetString("source"))
	record.Set("status", "installed")
	record.Set("runtime_status", "running")
	record.Set("runtime_reason", "")
	record.Set("last_deployment_status", deploymentRecord.GetString("status"))
	record.Set("last_action", "deploy")
	record.Set("last_action_at", time.Now())
	record.Set("last_deployed_at", time.Now())

	if err := saveDeploymentComposeToIAC(record.Id, deploymentRecord.GetString("compose_project_name"), deploymentRecord.GetString("rendered_compose")); err != nil {
		return err
	}

	return app.Save(record)
}

func normalizeAppInstanceServerID(serverID string) string {
	if serverID == "" {
		return "local"
	}
	return serverID
}

func saveDeploymentComposeToIAC(id string, name string, content string) error {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	shortID := id
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}
	path := filepath.Join("/appos/data/apps/installed", shortID+"-"+slugifyDeploymentName(name), "docker-compose.yml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

func slugifyDeploymentName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var builder strings.Builder
	lastDash := false
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastDash = false
		case !lastDash:
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}