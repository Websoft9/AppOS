package routes

import (
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/core"

	servers "github.com/websoft9/appos/backend/domain/resource/servers"
)

var serverCredentialTypeLabels = map[string]string{
	"single_value": "Password",
	"ssh_key":      "SSH Key",
}

func resolveServerCreatorName(app core.App, createdBy string) string {
	createdBy = strings.TrimSpace(createdBy)
	if createdBy == "" {
		return ""
	}

	for _, collection := range []string{"users", "_superusers"} {
		record, err := app.FindRecordById(collection, createdBy)
		if err != nil || record == nil {
			continue
		}
		for _, key := range []string{"name", "username", "email"} {
			value := strings.TrimSpace(record.GetString(key))
			if value != "" {
				return value
			}
		}
	}

	return createdBy
}

type directAccessProbeResult struct {
	Access    servers.AccessView
	LatencyMS int64
	Detail    string
}

var directServerAccessProbe = probeDirectServerAccess

// @Summary List server view items
// @Description Returns the server registry read model used by the UI, including backend-derived access and tunnel state. Superuser only.
// @Tags Servers
// @Security BearerAuth
// @Success 200 {object} map[string]any "items: server registry view rows"
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/servers/connection [get]
func handleServersView(e *core.RequestEvent) error {
	records, err := e.App.FindAllRecords("servers")
	if err != nil {
		return e.InternalServerError("failed to load servers", err)
	}

	sort.Slice(records, func(i, j int) bool {
		left := strings.ToLower(strings.TrimSpace(records[i].GetString("name")))
		right := strings.ToLower(strings.TrimSpace(records[j].GetString("name")))
		if left == right {
			return records[i].Id < records[j].Id
		}
		return left < right
	})

	credentialTypeByID := make(map[string]string, len(records))
	creatorNameByID := make(map[string]string, len(records))
	for _, record := range records {
		credentialID := strings.TrimSpace(record.GetString("credential"))
		if credentialID == "" {
		} else if _, seen := credentialTypeByID[credentialID]; !seen {
			secret, findErr := e.App.FindRecordById("secrets", credentialID)
			if findErr != nil {
				credentialTypeByID[credentialID] = ""
			} else {
				templateID := strings.TrimSpace(secret.GetString("template_id"))
				credentialTypeByID[credentialID] = serverCredentialTypeLabels[templateID]
			}
		}

		createdBy := strings.TrimSpace(record.GetString("created_by"))
		if createdBy == "" {
			continue
		}
		if _, seen := creatorNameByID[createdBy]; seen {
			continue
		}
		creatorNameByID[createdBy] = resolveServerCreatorName(e.App, createdBy)
	}

	items := make([]servers.ServerViewItem, len(records))
	var wg sync.WaitGroup
	for idx, record := range records {
		wg.Add(1)
		go func(index int, serverRecord *core.Record) {
			defer wg.Done()
			credentialID := strings.TrimSpace(serverRecord.GetString("credential"))
			createdBy := strings.TrimSpace(serverRecord.GetString("created_by"))
			item := servers.BuildServerViewItem(serverRecord, credentialTypeByID[credentialID], creatorNameByID[createdBy], tunnelSessions)
			if item.ConnectType == string(servers.ConnectionModeDirect) {
				item.Access = directServerAccessProbe(item.Host, item.Port).Access
			}
			items[index] = item
		}(idx, record)
	}
	wg.Wait()

	return e.JSON(http.StatusOK, map[string]any{"items": items})
}

func probeDirectServerAccess(host string, port int) directAccessProbeResult {
	now := time.Now().UTC().Format(time.RFC3339)
	result := directAccessProbeResult{
		Access: servers.AccessView{
			Status:    "unavailable",
			Reason:    "tcp_connect_failed",
			CheckedAt: now,
			Source:    "tcp_probe",
		},
	}

	host = strings.TrimSpace(host)
	if host == "" {
		result.Access.Reason = "server_host_empty"
		result.Detail = "server host is empty"
		return result
	}

	if port <= 0 {
		port = 22
	}

	start := time.Now()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)), 5*time.Second)
	if err != nil {
		result.Detail = err.Error()
		return result
	}
	_ = conn.Close()

	result.Access.Status = "available"
	result.Access.Reason = ""
	result.LatencyMS = time.Since(start).Milliseconds()
	return result
}