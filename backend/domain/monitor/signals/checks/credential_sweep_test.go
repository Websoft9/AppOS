package checks_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/domain/monitor/signals/checks"
	"github.com/websoft9/appos/backend/domain/monitor/status/store"
	"github.com/websoft9/appos/backend/domain/resource/instances"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/collections"
	persistence "github.com/websoft9/appos/backend/infra/persistence"

	_ "github.com/websoft9/appos/backend/infra/migrations"
)

func TestRunInstanceCredentialSweepProjectsCredentialInvalidWhenSecretMissing(t *testing.T) {
	prepareMonitorSecretKey(t)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	secret := seedMonitorSecretRecord(t, app, "secretredis0001", secrets.StatusRevoked)
	instance := seedMonitorInstanceRecord(t, app, instances.KindRedis, "generic-redis", "127.0.0.1:6379")
	instance.Set("credential", secret.Id)
	if err := app.Save(instance); err != nil {
		t.Fatal(err)
	}

	if err := checks.RunInstanceCredentialSweep(app, persistence.NewInstanceRepository(app), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	status := loadMonitorLatestStatusRecord(t, app, instance.Id)
	if got := status.GetString("status"); got != monitor.StatusCredentialInvalid {
		t.Fatalf("expected credential_invalid status, got %q", got)
	}
	summary, err := store.SummaryFromRecord(status)
	if err != nil {
		t.Fatal(err)
	}
	if summary["check_kind"] != monitor.CheckKindCredential {
		t.Fatalf("expected credential check kind, got %+v", summary)
	}
	if summary["reason_code"] != "credential_auth_failed" {
		t.Fatalf("expected credential_auth_failed reason_code, got %+v", summary)
	}
}

func TestRunInstanceCredentialSweepSkipsRedisWithoutCredential(t *testing.T) {
	prepareMonitorSecretKey(t)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	seedMonitorSecretRecord(t, app, "secretredis0002", secrets.StatusActive)
	instance := seedMonitorInstanceRecord(t, app, instances.KindRedis, "generic-redis", "127.0.0.1:6379")
	if err := app.Save(instance); err != nil {
		t.Fatal(err)
	}

	if err := checks.RunInstanceCredentialSweep(app, persistence.NewInstanceRepository(app), time.Now().UTC()); err != nil {
		t.Fatal(err)
	}

	if _, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": monitor.TargetTypeResource, "targetID": instance.Id},
	); err == nil {
		t.Fatal("expected redis instance without credential to remain outside credential projection")
	}
}

func TestCheckInstanceCredentialReturnsCredentialInvalidForMissingSecret(t *testing.T) {
	prepareMonitorSecretKey(t)
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatal(err)
	}
	defer app.Cleanup()

	item := instances.RestoreInstance(instances.Snapshot{
		ID:           "inst-1",
		Name:         "redis-primary",
		Kind:         instances.KindRedis,
		TemplateID:   "generic-redis",
		Endpoint:     "127.0.0.1:6379",
		CredentialID: "missing-secret",
	})
	target, ok, err := monitor.ResolveInstanceTarget(item)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("expected redis target")
	}
	result := checks.CheckInstanceCredential(app, target)
	if result.Status != monitor.StatusCredentialInvalid {
		t.Fatalf("expected credential_invalid result, got %+v", result)
	}
}

func seedMonitorInstanceRecord(t *testing.T, app core.App, kind string, templateID string, endpoint string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId(collections.Instances)
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("name", fmt.Sprintf("%s-primary", kind))
	rec.Set("kind", kind)
	rec.Set("template_id", templateID)
	rec.Set("endpoint", endpoint)
	rec.Set("config", map[string]any{})
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func seedMonitorSecretRecord(t *testing.T, app core.App, secretID string, status string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		t.Fatal(err)
	}
	enc, err := secrets.EncryptPayload(map[string]any{"value": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	rec := core.NewRecord(col)
	rec.Set("id", secretID)
	rec.Set("name", secretID)
	rec.Set("scope", secrets.ScopeGlobal)
	rec.Set("status", status)
	rec.Set("template_id", secrets.TemplateSingleValue)
	rec.Set("payload_encrypted", enc)
	rec.Set("created_source", secrets.CreatedSourceUser)
	rec.Set("created_by", "user-1")
	if err := app.Save(rec); err != nil {
		t.Fatal(err)
	}
	return rec
}

func loadMonitorLatestStatusRecord(t *testing.T, app core.App, targetID string) *core.Record {
	t.Helper()
	record, err := app.FindFirstRecordByFilter(
		collections.MonitorLatestStatus,
		"target_type = {:targetType} && target_id = {:targetID}",
		map[string]any{"targetType": monitor.TargetTypeResource, "targetID": targetID},
	)
	if err != nil {
		t.Fatal(err)
	}
	return record
}

func prepareMonitorSecretKey(t *testing.T) {
	t.Helper()
	t.Setenv(secrets.EnvSecretKey, "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=")
	if err := secrets.LoadKeyFromEnv(); err != nil {
		t.Fatal(err)
	}
}
