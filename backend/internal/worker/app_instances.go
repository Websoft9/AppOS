package worker

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/deploy"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
	"github.com/websoft9/appos/backend/internal/lifecycle/projection"
)

func syncAppInstanceFromDeployment(app core.App, deploymentRecord *core.Record) error {
	if deploymentRecord == nil || deploymentRecord.GetString("status") != deploy.StatusSuccess {
		return nil
	}

	col, err := app.FindCollectionByNameOrId("app_instances")
	if err != nil {
		return err
	}

	serverID := normalizeAppInstanceServerID(deploymentRecord.GetString("server_id"))
	appName := deploymentRecord.GetString("compose_project_name")
	filter := fmt.Sprintf(`server_id = "%s" && name = "%s"`, serverID, appName)
	record, err := app.FindFirstRecordByFilter("app_instances", filter)
	if err != nil || record == nil {
		record = core.NewRecord(col)
		record.Set("key", fmt.Sprintf("legacy-%s-%d", slugifyDeploymentName(appName), time.Now().UnixNano()))
		record.Set("name", appName)
		record.Set("server_id", serverID)
	}

	appProjection := projection.ReadAppInstanceProjection(record)
	appProjection.LifecycleState = model.AppStateRunningHealthy
	appProjection.HealthSummary = model.HealthHealthy
	if appProjection.PublicationSummary == "" {
		appProjection.PublicationSummary = model.PublicationUnpublished
	}
	if appProjection.DesiredState == "" {
		appProjection.DesiredState = model.DesiredStateRunning
	}
	appProjection.StateReason = "legacy deployment synchronized"
	if appProjection.InstalledAt == nil {
		now := time.Now().UTC()
		appProjection.InstalledAt = &now
	}
	projection.ApplyAppInstanceProjection(record, appProjection)

	if err := saveDeploymentComposeToIAC(record.Id, appName, deploymentRecord.GetString("rendered_compose")); err != nil {
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
