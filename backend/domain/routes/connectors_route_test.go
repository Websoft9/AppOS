package routes

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/secrets"
)

func ensureConnectorSecretRuntime(t *testing.T) {
	t.Helper()
	key := base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	t.Setenv(secrets.EnvSecretKey, key)
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
}

func createRouteSecret(t *testing.T, te *testEnv, scope, createdBy string) *core.Record {
	t.Helper()
	col, err := te.app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", "connector-secret")
	rec.Set("template_id", "single_value")
	rec.Set("scope", scope)
	rec.Set("access_mode", "use_only")
	rec.Set("status", "active")
	rec.Set("created_by", createdBy)
	enc, err := secrets.EncryptPayload(map[string]any{"value": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	rec.Set("payload_encrypted", enc)
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func auditEntriesByAction(t *testing.T, te *testEnv, action string) []*core.Record {
	t.Helper()
	entries, err := te.app.FindRecordsByFilter("audit_logs", "action = {:action}", "", 0, 0, map[string]any{"action": action})
	if err != nil {
		t.Fatal(err)
	}
	return entries
}

func TestConnectorCreateReturnsCreatedAndAudits(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"workspace-openai","kind":"llm","is_default":true,"template_id":"openai"}`,
		true)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	entries := auditEntriesByAction(t, te, "connector.create")
	if len(entries) != 1 {
		t.Fatalf("expected 1 create audit entry, got %d", len(entries))
	}
	if entries[0].GetString("status") != audit.StatusSuccess {
		t.Fatalf("expected successful create audit, got %q", entries[0].GetString("status"))
	}
}

func TestConnectorRejectsBlankName(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"   ","kind":"llm","template_id":"openai"}`,
		true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got == "" {
		t.Fatal("expected validation response body")
	}
}

func TestConnectorRejectsMissingCredentialReference(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"smtp","kind":"smtp","template_id":"generic-smtp","endpoint":"smtp://smtp.example.com:587","credential":"missing-secret"}`,
		true)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(auditEntriesByAction(t, te, "connector.create")) != 0 {
		t.Fatal("expected credential pre-validation failures to avoid mutation audit")
	}
}

func TestConnectorRejectsPrivateCredentialOfAnotherUser(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()
	secret := createRouteSecret(t, te, "user_private", "someone-else")

	rec := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"smtp","kind":"smtp","template_id":"generic-smtp","endpoint":"smtp://smtp.example.com:587","credential":"`+secret.Id+`"}`,
		true)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestConnectorUpdateMissingReturnsNotFound(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.do(t, http.MethodPut, "/api/connectors/missing-id",
		`{"name":"workspace-openai","kind":"llm","template_id":"openai"}`,
		true)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLoadConnectorBackedSettingsReturnsErrorForBrokenSMTPConnector(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	connectorsCol, err := te.app.FindCollectionByNameOrId("connectors")
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(connectorsCol)
	rec.Set("name", "broken-smtp")
	rec.Set("kind", "smtp")
	rec.Set("is_default", true)
	rec.Set("template_id", "generic-smtp")
	rec.Set("endpoint", "http://smtp.example.com")
	rec.Set("credential", "")
	if err := te.app.Save(rec); err != nil {
		t.Fatal(err)
	}

	value, handled, err := loadConnectorBackedSettingsEntryValue(te.app, "smtp")
	if err == nil {
		t.Fatal("expected broken smtp connector to return error")
	}
	if !handled {
		t.Fatal("expected smtp connector entry to be marked handled")
	}
	if value != nil {
		t.Fatalf("expected nil value on error, got %#v", value)
	}
}

func decodeAuditDetail(t *testing.T, entry *core.Record) map[string]any {
	t.Helper()
	raw := entry.GetString("detail")
	if raw == "" {
		t.Fatal("audit detail is empty")
	}
	var detail map[string]any
	if err := json.Unmarshal([]byte(raw), &detail); err != nil {
		t.Fatalf("failed to decode audit detail: %v", err)
	}
	return detail
}

func TestConnectorUpdateSuccessAuditsBeforeAfter(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	// Create a connector first
	create := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"orig-llm","kind":"llm","is_default":true,"template_id":"openai"}`,
		true)
	if create.Code != http.StatusCreated {
		t.Fatalf("setup create failed: %d %s", create.Code, create.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)

	// Update it
	rec := te.do(t, http.MethodPut, "/api/connectors/"+id,
		`{"name":"renamed-llm","kind":"llm","is_default":true,"template_id":"openai"}`,
		true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	entries := auditEntriesByAction(t, te, "connector.update")
	if len(entries) != 1 {
		t.Fatalf("expected 1 update audit entry, got %d", len(entries))
	}
	entry := entries[0]
	if entry.GetString("status") != audit.StatusSuccess {
		t.Fatalf("expected successful update audit, got %q", entry.GetString("status"))
	}
	detail := decodeAuditDetail(t, entry)
	if detail["before"] == nil || detail["after"] == nil {
		t.Fatalf("expected before/after in audit detail, got %v", detail)
	}
	before := detail["before"].(map[string]any)
	after := detail["after"].(map[string]any)
	if before["name"] != "orig-llm" {
		t.Fatalf("expected before name 'orig-llm', got %q", before["name"])
	}
	if after["name"] != "renamed-llm" {
		t.Fatalf("expected after name 'renamed-llm', got %q", after["name"])
	}
}

func TestConnectorDeleteSuccessReturns204AndAudits(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	create := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"to-delete","kind":"llm","is_default":false,"template_id":"openai"}`,
		true)
	if create.Code != http.StatusCreated {
		t.Fatalf("setup create failed: %d %s", create.Code, create.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(create.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	id := created["id"].(string)

	rec := te.do(t, http.MethodDelete, "/api/connectors/"+id, "", true)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}

	entries := auditEntriesByAction(t, te, "connector.delete")
	if len(entries) != 1 {
		t.Fatalf("expected 1 delete audit entry, got %d", len(entries))
	}
	if entries[0].GetString("status") != audit.StatusSuccess {
		t.Fatalf("expected successful delete audit, got %q", entries[0].GetString("status"))
	}
	detail := decodeAuditDetail(t, entries[0])
	if detail["before"] == nil {
		t.Fatal("expected before snapshot in delete audit detail")
	}
}

func TestConnectorCreateDefaultClearsPreviousDefault(t *testing.T) {
	ensureConnectorSecretRuntime(t)
	te := newTestEnv(t)
	defer te.cleanup()

	// Create first default LLM
	first := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"first-llm","kind":"llm","is_default":true,"template_id":"openai"}`,
		true)
	if first.Code != http.StatusCreated {
		t.Fatalf("first create failed: %d %s", first.Code, first.Body.String())
	}
	var firstBody map[string]any
	if err := json.Unmarshal(first.Body.Bytes(), &firstBody); err != nil {
		t.Fatal(err)
	}
	firstID := firstBody["id"].(string)

	// Create second default LLM
	second := te.do(t, http.MethodPost, "/api/connectors",
		`{"name":"second-llm","kind":"llm","is_default":true,"template_id":"anthropic"}`,
		true)
	if second.Code != http.StatusCreated {
		t.Fatalf("second create failed: %d %s", second.Code, second.Body.String())
	}

	// Verify first is no longer default
	get := te.do(t, http.MethodGet, "/api/connectors/"+firstID, "", true)
	if get.Code != http.StatusOK {
		t.Fatalf("get failed: %d %s", get.Code, get.Body.String())
	}
	var firstReloaded map[string]any
	if err := json.Unmarshal(get.Body.Bytes(), &firstReloaded); err != nil {
		t.Fatal(err)
	}
	if firstReloaded["is_default"] == true {
		t.Fatal("expected first connector's is_default to be cleared after second default was created")
	}
}
