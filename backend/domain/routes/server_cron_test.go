package routes

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	serversvc "github.com/websoft9/appos/backend/domain/resource/servers/service"
	"github.com/websoft9/appos/backend/domain/terminal"
)

const (
	testManagedCronRegistryOutputPrefix = "__APPOS_REGISTRY__"
	testManagedCronFilesOutputPrefix    = "__APPOS_FILES__\n"
)

func createCronCapableServer(t *testing.T, te *testEnv) string {
	t.Helper()
	secretID := createTestSecret(t, te, "server-password", "active", "global", "system", map[string]any{"value": "secret"})
	server := createServerRecord(t, te, "cron-edge", "10.0.0.10", 22, "root", "password")
	server.Set("credential", secretID)
	if err := te.app.Save(server); err != nil {
		t.Fatalf("save server credential: %v", err)
	}
	return server.Id
}

func decodeCrontabWriteCommand(t *testing.T, command string) string {
	t.Helper()
	const prefix = "printf '%s' '"
	const suffix = "' | base64 -d |"
	start := strings.Index(command, prefix)
	end := strings.Index(command, suffix)
	if start < 0 || end < 0 || end <= start+len(prefix) {
		t.Fatalf("unexpected write command: %q", command)
	}
	encoded := command[start+len(prefix) : end]
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("decode write payload: %v", err)
	}
	return string(decoded)
}

func encodeManagedCronLoadOutput(t *testing.T, registry string, activeFiles ...string) string {
	t.Helper()
	registryEncoded := ""
	if strings.TrimSpace(registry) != "" {
		registryEncoded = base64.StdEncoding.EncodeToString([]byte(registry))
	}
	result := testManagedCronRegistryOutputPrefix + registryEncoded + "\n" + testManagedCronFilesOutputPrefix
	if len(activeFiles) > 0 {
		result += strings.Join(activeFiles, "\n")
	}
	return result
}

func decodeBase64WriteForTarget(t *testing.T, script string, target string) string {
	t.Helper()
	for _, line := range strings.Split(script, "\n") {
		if !strings.Contains(line, target) || !strings.Contains(line, "| base64 -d > ") {
			continue
		}
		const prefix = "printf '%s' '"
		const suffix = "' | base64 -d > "
		start := strings.Index(line, prefix)
		end := strings.Index(line, suffix)
		if start < 0 || end < 0 || end <= start+len(prefix) {
			t.Fatalf("unexpected embedded payload line for %q: %q", target, line)
		}
		decoded, err := base64.StdEncoding.DecodeString(line[start+len(prefix) : end])
		if err != nil {
			t.Fatalf("decode embedded payload for %q: %v", target, err)
		}
		return string(decoded)
	}
	t.Fatalf("expected target %q in script %q", target, script)
	return ""
}

func TestServerCronJobsListRequiresAuth(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, "GET", "/api/servers/nonexistent/ops/cron/jobs", "", false)
	if rec.Code != 401 {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerCronJobsCreateRejectsInvalidSchedule(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, "POST", "/api/servers/nonexistent/ops/cron/jobs", `{"name":"backup","schedule":"@daily","command":"echo ok","enabled":true}`, true)
	if rec.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerCronJobsCreateRejectsEmptyCommand(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doServer(t, "POST", "/api/servers/nonexistent/ops/cron/jobs", `{"name":"backup","schedule":"0 2 * * *","command":"   ","enabled":true}`, true)
	if rec.Code != 400 {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServerCronJobsListReturnsManagedEntriesOnly(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	serverID := createCronCapableServer(t, te)
	registry := serversvc.ManagedCronRegistryDocument{Jobs: []serversvc.ManagedCronJob{
		{EntryID: "cron_alpha", Name: "nocturnal-backup", Schedule: "0 2 * * *", Command: "/opt/bin/backup.sh --full", Enabled: true, Source: "managed"},
		{EntryID: "cron_beta", Name: "prune-tmp", Schedule: "0 4 * * 0", Command: "find /tmp -type f -delete", Enabled: false, Source: "managed"},
	}}

	originalExec := executeServerCronCommand
	executeServerCronCommand = func(_ context.Context, _ terminal.ConnectorConfig, command string, _ time.Duration) (string, error) {
		decoded := decodeCrontabWriteCommand(t, command)
		if !strings.Contains(decoded, "registry_path='"+serversvc.ManagedCronRegistryPath()+"'") {
			t.Fatalf("expected managed registry load command, got %q", command)
		}
		return encodeManagedCronLoadOutput(t, registry.Render(), serversvc.ManagedCronFileName("cron_alpha")), nil
	}
	defer func() { executeServerCronCommand = originalExec }()

	rec := te.doServer(t, "GET", "/api/servers/"+serverID+"/ops/cron/jobs", "", true)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		Items []serversvc.ManagedCronJob `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(payload.Items) != 2 {
		t.Fatalf("expected 2 managed entries, got %d", len(payload.Items))
	}
	if payload.Items[0].EntryID != "cron_alpha" || payload.Items[0].Name != "nocturnal-backup" || !payload.Items[0].Enabled {
		t.Fatalf("unexpected first item: %+v", payload.Items[0])
	}
	if payload.Items[1].EntryID != "cron_beta" || payload.Items[1].Name != "prune-tmp" || payload.Items[1].Enabled {
		t.Fatalf("unexpected second item: %+v", payload.Items[1])
	}
	if payload.Items[1].Command != "find /tmp -type f -delete" {
		t.Fatalf("expected disabled command to round-trip, got %q", payload.Items[1].Command)
	}
	if payload.Items[0].Path != serversvc.ManagedCronFilePath("cron_alpha") {
		t.Fatalf("expected runtime path, got %+v", payload.Items[0])
	}
	if payload.Items[1].Path != serversvc.ManagedCronFilePath("cron_beta") {
		t.Fatalf("expected runtime path, got %+v", payload.Items[1])
	}
	if payload.Items[0].Source != "managed" {
		t.Fatalf("expected managed source, got %+v", payload.Items[0])
	}
}

func TestServerCronJobTestRunsManagedCommandImmediately(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	serverID := createCronCapableServer(t, te)
	registry := serversvc.ManagedCronRegistryDocument{Jobs: []serversvc.ManagedCronJob{{
		EntryID: "cron_alpha", Name: "backup", Schedule: "0 2 * * *", Command: "/opt/bin/backup.sh --full", Enabled: true, SingleRunOnly: true, Source: "managed",
	}}}

	originalExec := executeServerCronCommand
	callCount := 0
	executeServerCronCommand = func(_ context.Context, _ terminal.ConnectorConfig, command string, _ time.Duration) (string, error) {
		callCount++
		if callCount == 1 {
			return encodeManagedCronLoadOutput(t, registry.Render(), serversvc.ManagedCronFileName("cron_alpha")), nil
		}
		if command != "/bin/sh -lc '/opt/bin/backup.sh --full'" {
			t.Fatalf("expected one-shot cron test command, got %q", command)
		}
		if strings.Contains(command, "rm -f /etc/cron.d/") {
			t.Fatalf("expected test execution to avoid cron file deletion wrapper, got %q", command)
		}
		return "test ok", nil
	}
	defer func() { executeServerCronCommand = originalExec }()

	rec := te.doServer(t, "POST", "/api/servers/"+serverID+"/ops/cron/jobs/cron_alpha/test", "", true)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload struct {
		EntryID string `json:"entryId"`
		Output  string `json:"output"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if payload.EntryID != "cron_alpha" || payload.Output != "test ok" {
		t.Fatalf("unexpected test response: %+v", payload)
	}
}

func TestManagedCrontabUpdatePreservesUnmanagedLines(t *testing.T) {
	raw := strings.Join([]string{
		"SHELL=/bin/bash",
		managedCronMarkerPrefix + `{"id":"cron_alpha","name_b64":"YmFja3Vw"}`,
		"0 2 * * * /opt/bin/backup.sh",
		"# third-party comment",
		"15 4 * * * /usr/local/bin/unmanaged.sh",
	}, "\n")

	doc := serversvc.ParseManagedCrontab(raw)
	segment := doc.Find("cron_alpha")
	if segment == nil || segment.Job == nil {
		t.Fatal("expected managed cron block to parse")
	}
	segment.Job.Command = "/opt/bin/backup.sh --full"
	segment.Job.Enabled = false

	rendered := doc.Render()
	if !strings.Contains(rendered, "SHELL=/bin/bash") {
		t.Fatalf("expected shell line preserved, got %q", rendered)
	}
	if !strings.Contains(rendered, "15 4 * * * /usr/local/bin/unmanaged.sh") {
		t.Fatalf("expected unmanaged line preserved, got %q", rendered)
	}
	if !strings.Contains(rendered, "# 0 2 * * * /opt/bin/backup.sh --full") {
		t.Fatalf("expected managed line updated in-place, got %q", rendered)
	}
	if strings.Contains(rendered, "# third-party comment\n# third-party comment") {
		t.Fatalf("unexpected duplicate lines after render: %q", rendered)
	}
	if len(doc.Items()) != 1 {
		t.Fatalf("expected one managed item, got %d", len(doc.Items()))
	}
	if doc.Items()[0].Name != "backup" {
		t.Fatalf("expected decoded name, got %+v", doc.Items()[0])
	}
	if _, _, err := serversvc.SplitCronSpec("0 2 * * *"); err == nil {
		t.Fatal("expected splitCronSpec to reject missing command")
	}
	if _, _, err := serversvc.SplitCronSpec("0 2 * * * /opt/bin/backup.sh"); err != nil {
		t.Fatalf("expected splitCronSpec to accept valid spec: %v", err)
	}
}

func TestServerCronJobCreateWritesManagedBlock(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	serverID := createCronCapableServer(t, te)
	originalExec := executeServerCronCommand
	var wrote string
	callCount := 0
	executeServerCronCommand = func(_ context.Context, _ terminal.ConnectorConfig, command string, _ time.Duration) (string, error) {
		callCount++
		if callCount == 1 {
			return encodeManagedCronLoadOutput(t, ""), nil
		}
		wrote = decodeCrontabWriteCommand(t, command)
		return "ok", nil
	}
	defer func() { executeServerCronCommand = originalExec }()

	rec := te.doServer(t, "POST", "/api/servers/"+serverID+"/ops/cron/jobs", `{"name":"nightly-backup","schedule":"0 2 * * *","command":"/opt/bin/backup.sh","enabled":true}`, true)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(wrote, serversvc.ManagedCronRuntimeDir) {
		t.Fatalf("expected /etc/cron.d write script, got %q", wrote)
	}
	registryJSON := decodeBase64WriteForTarget(t, wrote, "registry.json")
	if !strings.Contains(registryJSON, "nightly-backup") || !strings.Contains(registryJSON, "/opt/bin/backup.sh") {
		t.Fatalf("expected job in registry payload, got %q", registryJSON)
	}
	if !strings.Contains(wrote, serversvc.ManagedCronRuntimeDir+"/appos-managed-cron-") {
		t.Fatalf("expected runtime file install in write script, got %q", wrote)
	}

	var payload serversvc.ManagedCronJob
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}
	if payload.Path == "" || !strings.HasPrefix(payload.Path, serversvc.ManagedCronRuntimeDir+"/") {
		t.Fatalf("expected create response path, got %+v", payload)
	}
}

func TestServerCronJobUpdateReturnsRuntimePath(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	serverID := createCronCapableServer(t, te)
	registry := serversvc.ManagedCronRegistryDocument{Jobs: []serversvc.ManagedCronJob{{
		EntryID: "cron_alpha", Name: "backup", Schedule: "0 2 * * *", Command: "/opt/bin/backup.sh", Enabled: true, Source: "managed",
	}}}
	originalExec := executeServerCronCommand
	callCount := 0
	executeServerCronCommand = func(_ context.Context, _ terminal.ConnectorConfig, command string, _ time.Duration) (string, error) {
		callCount++
		if callCount == 1 {
			return encodeManagedCronLoadOutput(t, registry.Render(), serversvc.ManagedCronFileName("cron_alpha")), nil
		}
		return "ok", nil
	}
	defer func() { executeServerCronCommand = originalExec }()

	rec := te.doServer(t, "PUT", "/api/servers/"+serverID+"/ops/cron/jobs/cron_alpha", `{"name":"backup","schedule":"0 3 * * *","command":"/opt/bin/backup.sh --full","enabled":true,"singleRunOnly":true}`, true)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload serversvc.ManagedCronJob
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal update response: %v", err)
	}
	if payload.Path != serversvc.ManagedCronFilePath("cron_alpha") {
		t.Fatalf("expected update response path, got %+v", payload)
	}
	if !payload.SingleRunOnly {
		t.Fatalf("expected update response to preserve singleRunOnly, got %+v", payload)
	}
}

func TestServerCronJobDisableWritesCommentedSpec(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	serverID := createCronCapableServer(t, te)
	registry := serversvc.ManagedCronRegistryDocument{Jobs: []serversvc.ManagedCronJob{{
		EntryID: "cron_alpha", Name: "backup", Schedule: "0 2 * * *", Command: "/opt/bin/backup.sh", Enabled: true, Source: "managed",
	}}}
	originalExec := executeServerCronCommand
	var wrote string
	callCount := 0
	executeServerCronCommand = func(_ context.Context, _ terminal.ConnectorConfig, command string, _ time.Duration) (string, error) {
		callCount++
		if callCount == 1 {
			return encodeManagedCronLoadOutput(t, registry.Render(), serversvc.ManagedCronFileName("cron_alpha")), nil
		}
		wrote = decodeCrontabWriteCommand(t, command)
		return "ok", nil
	}
	defer func() { executeServerCronCommand = originalExec }()

	rec := te.doServer(t, "POST", "/api/servers/"+serverID+"/ops/cron/jobs/cron_alpha/disable", "", true)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	registryJSON := decodeBase64WriteForTarget(t, wrote, "registry.json")
	if !strings.Contains(registryJSON, "\"enabled\": false") {
		t.Fatalf("expected disabled registry payload, got %q", registryJSON)
	}
	if strings.Contains(wrote, serversvc.ManagedCronFilePath("cron_alpha")) {
		t.Fatalf("expected disabled job to skip runtime file install, got %q", wrote)
	}
}

func TestServerCronJobDeleteRemovesManagedBlock(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	serverID := createCronCapableServer(t, te)
	registry := serversvc.ManagedCronRegistryDocument{Jobs: []serversvc.ManagedCronJob{{
		EntryID: "cron_alpha", Name: "backup", Schedule: "0 2 * * *", Command: "/opt/bin/backup.sh", Enabled: true, Source: "managed",
	}}}
	originalExec := executeServerCronCommand
	var wrote string
	callCount := 0
	executeServerCronCommand = func(_ context.Context, _ terminal.ConnectorConfig, command string, _ time.Duration) (string, error) {
		callCount++
		if callCount == 1 {
			return encodeManagedCronLoadOutput(t, registry.Render(), serversvc.ManagedCronFileName("cron_alpha")), nil
		}
		wrote = decodeCrontabWriteCommand(t, command)
		return "ok", nil
	}
	defer func() { executeServerCronCommand = originalExec }()

	rec := te.doServer(t, "DELETE", "/api/servers/"+serverID+"/ops/cron/jobs/cron_alpha", "", true)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	registryJSON := decodeBase64WriteForTarget(t, wrote, "registry.json")
	if strings.Contains(registryJSON, "cron_alpha") || strings.Contains(registryJSON, "backup.sh") {
		t.Fatalf("expected deleted job removed from registry payload, got %q", registryJSON)
	}
	if strings.Contains(wrote, serversvc.ManagedCronFilePath("cron_alpha")) {
		t.Fatalf("expected deleted job runtime file removed, got %q", wrote)
	}
}

func TestServerCronJobTestTruncatesOutput(t *testing.T) {
	te := resolverTestEnv(t)
	defer te.cleanup()

	serverID := createCronCapableServer(t, te)
	registry := serversvc.ManagedCronRegistryDocument{Jobs: []serversvc.ManagedCronJob{{
		EntryID: "cron_alpha", Name: "backup", Schedule: "0 2 * * *", Command: "/opt/bin/backup.sh --full", Enabled: true, Source: "managed",
	}}}
	longOutput := strings.Repeat("x", maxManagedCronTestOutputLen+32)

	originalExec := executeServerCronCommand
	callCount := 0
	executeServerCronCommand = func(_ context.Context, _ terminal.ConnectorConfig, command string, _ time.Duration) (string, error) {
		callCount++
		if callCount == 1 {
			return encodeManagedCronLoadOutput(t, registry.Render(), serversvc.ManagedCronFileName("cron_alpha")), nil
		}
		if command != "/bin/sh -lc '/opt/bin/backup.sh --full'" {
			t.Fatalf("expected one-shot cron test command, got %q", command)
		}
		return longOutput, fmt.Errorf("boom")
	}
	defer func() { executeServerCronCommand = originalExec }()

	rec := te.doServer(t, "POST", "/api/servers/"+serverID+"/ops/cron/jobs/cron_alpha/test", "", true)
	if rec.Code != 500 {
		t.Fatalf("expected 500, got %d: %s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal error response: %v", err)
	}
	output, _ := payload["output"].(string)
	if len(output) > maxManagedCronTestOutputLen+len("\n... output truncated ...") {
		t.Fatalf("expected truncated output, got len=%d", len(output))
	}
	if !strings.Contains(output, "... output truncated ...") {
		t.Fatalf("expected truncation marker, got %q", output)
	}
}
