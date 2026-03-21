package secrets

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/audit"
)

func RegisterHooks(app *pocketbase.PocketBase) {
	app.OnRecordCreateRequest("secrets").BindFunc(func(e *core.RecordRequestEvent) error {
		applyDefaultAccessMode(app, e.Record)

		templateID := e.Record.GetString("template_id")
		tpl, ok := FindTemplate(templateID)
		if !ok {
			return apis.NewBadRequestError("invalid template_id", nil)
		}

		payload, err := payloadFromAny(e.Record.Get("payload"))
		if err != nil {
			return apis.NewBadRequestError("invalid payload", err)
		}

		if err := ValidatePayload(payload, tpl); err != nil {
			return apis.NewBadRequestError(err.Error(), nil)
		}

		enc, err := EncryptPayload(payload)
		if err != nil {
			return apis.NewBadRequestError("failed to encrypt payload", err)
		}

		e.Record.Set("payload_encrypted", enc)
		e.Record.Set("payload_meta", BuildPayloadMeta(payload, tpl))
		e.Record.Set("version", 1)
		e.Record.Set("status", "active")
		if e.Record.GetString("created_source") == "" {
			e.Record.Set("created_source", "user")
		}
		if e.Auth != nil {
			e.Record.Set("created_by", e.Auth.Id)
		}
		e.Record.Set("payload", nil)

		err = e.Next()
		if err == nil {
			audit.Write(app, audit.Entry{
				UserID:       actorID(e.Auth),
				UserEmail:    actorEmail(e.Auth),
				Action:       "secret.create",
				ResourceType: "secret",
				ResourceID:   e.Record.Id,
				ResourceName: e.Record.GetString("name"),
				Status:       audit.StatusSuccess,
				IP:           e.RealIP(),
				UserAgent:    e.Request.Header.Get("User-Agent"),
			})
		}
		return err
	})

	app.OnRecordUpdateRequest("secrets").BindFunc(func(e *core.RecordRequestEvent) error {
		existing, err := app.FindRecordById("secrets", e.Record.Id)
		if err != nil {
			return err
		}
		if isSystemManagedSecret(existing) {
			audit.Write(app, audit.Entry{
				UserID:       actorID(e.Auth),
				UserEmail:    actorEmail(e.Auth),
				Action:       "secret.update_denied",
				ResourceType: "secret",
				ResourceID:   existing.Id,
				ResourceName: existing.GetString("name"),
				Status:       audit.StatusFailed,
				IP:           e.RealIP(),
				UserAgent:    e.Request.Header.Get("User-Agent"),
				Detail: map[string]any{
					"reason_code": "system_secret_read_only",
				},
			})
			return apis.NewForbiddenError("system_secret_read_only", nil)
		}

		if existing.GetString("payload_encrypted") != e.Record.GetString("payload_encrypted") {
			return apis.NewForbiddenError("payload_encrypted cannot be updated directly", nil)
		}

		oldStatus := existing.GetString("status")
		newStatus := e.Record.GetString("status")
		if oldStatus != "revoked" && newStatus == "revoked" && !isSuperuser(e.Auth) {
			return apis.NewForbiddenError("only superuser can revoke secret", nil)
		}

		err = e.Next()
		if err != nil {
			return err
		}

		action := "secret.update"
		if oldStatus != "revoked" && newStatus == "revoked" {
			action = "secret.revoke"
		}

		audit.Write(app, audit.Entry{
			UserID:       actorID(e.Auth),
			UserEmail:    actorEmail(e.Auth),
			Action:       action,
			ResourceType: "secret",
			ResourceID:   e.Record.Id,
			ResourceName: e.Record.GetString("name"),
			Status:       audit.StatusSuccess,
			IP:           e.RealIP(),
			UserAgent:    e.Request.Header.Get("User-Agent"),
		})
		return nil
	})

	app.OnRecordDeleteRequest("secrets").BindFunc(func(e *core.RecordRequestEvent) error {
		if isSystemManagedSecret(e.Record) {
			audit.Write(app, audit.Entry{
				UserID:       actorID(e.Auth),
				UserEmail:    actorEmail(e.Auth),
				Action:       "secret.delete_denied",
				ResourceType: "secret",
				ResourceID:   e.Record.Id,
				ResourceName: e.Record.GetString("name"),
				Status:       audit.StatusFailed,
				IP:           e.RealIP(),
				UserAgent:    e.Request.Header.Get("User-Agent"),
				Detail: map[string]any{
					"reason_code": "system_secret_delete_forbidden",
				},
			})
			return apis.NewForbiddenError("system_secret_delete_forbidden", nil)
		}
		name := e.Record.GetString("name")
		id := e.Record.Id
		err := e.Next()
		if err == nil {
			audit.Write(app, audit.Entry{
				UserID:       actorID(e.Auth),
				UserEmail:    actorEmail(e.Auth),
				Action:       "secret.delete",
				ResourceType: "secret",
				ResourceID:   id,
				ResourceName: name,
				Status:       audit.StatusSuccess,
				IP:           e.RealIP(),
				UserAgent:    e.Request.Header.Get("User-Agent"),
			})
		}
		return err
	})
}

func applyDefaultAccessMode(app core.App, record *core.Record) {
	if app == nil || record == nil || strings.TrimSpace(record.GetString("access_mode")) != "" {
		return
	}

	policy := GetPolicy(app)
	record.Set("access_mode", policy.DefaultAccessMode)
}

func payloadFromAny(v any) (map[string]any, error) {
	if v == nil {
		return nil, fmt.Errorf("payload is required")
	}
	// Direct map (e.g. from internal Go callers)
	if m, ok := v.(map[string]any); ok {
		return m, nil
	}
	// PB JSONField stores values as types.JsonRaw (json.RawMessage / []byte)
	var raw []byte
	switch t := v.(type) {
	case []byte:
		raw = t
	case string:
		raw = []byte(t)
	default:
		// Try JSON round-trip for other types
		b, err := json.Marshal(v)
		if err != nil {
			return nil, fmt.Errorf("payload must be object")
		}
		raw = b
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("payload must be a JSON object")
	}
	return m, nil
}

func isSuperuser(auth *core.Record) bool {
	return auth != nil && auth.Collection().Name == core.CollectionNameSuperusers
}

func actorID(auth *core.Record) string {
	if auth == nil {
		return "system"
	}
	return auth.Id
}

func actorEmail(auth *core.Record) string {
	if auth == nil {
		return ""
	}
	return auth.GetString("email")
}

func isSystemManagedSecret(rec *core.Record) bool {
	if rec == nil {
		return false
	}
	if rec.GetString("created_source") == "system" {
		return true
	}
	// Legacy guard: old tunnel tokens may not have created_source populated yet.
	return rec.GetString("type") == "tunnel_token"
}
