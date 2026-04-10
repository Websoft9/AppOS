package secrets

import (
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
)

func RegisterHooks(app *pocketbase.PocketBase) {
	app.OnRecordCreateRequest("secrets").BindFunc(func(e *core.RecordRequestEvent) error {
		applyDefaultAccessMode(app, e.Record)
		applyExpiryPolicy(app, e.Record)

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
		e.Record.Set("status", StatusActive)
		if e.Record.GetString("created_source") == "" {
			e.Record.Set("created_source", CreatedSourceUser)
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
		existingSecret := From(existing)
		if existingSecret.IsSystemManaged() {
			audit.Write(app, audit.Entry{
				UserID:       actorID(e.Auth),
				UserEmail:    actorEmail(e.Auth),
				Action:       "secret.update_denied",
				ResourceType: "secret",
				ResourceID:   existingSecret.ID(),
				ResourceName: existingSecret.Name(),
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

		oldStatus := existingSecret.Status()
		newStatus := e.Record.GetString("status")
		if !existingSecret.IsRevoked() && newStatus == StatusRevoked && (e.Auth == nil || e.Auth.Collection().Name != core.CollectionNameSuperusers) {
			return apis.NewForbiddenError("only superuser can revoke secret", nil)
		}

		err = e.Next()
		if err != nil {
			return err
		}

		action := "secret.update"
		if oldStatus != StatusRevoked && newStatus == StatusRevoked {
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
		s := From(e.Record)
		if s.IsSystemManaged() {
			audit.Write(app, audit.Entry{
				UserID:       actorID(e.Auth),
				UserEmail:    actorEmail(e.Auth),
				Action:       "secret.delete_denied",
				ResourceType: "secret",
				ResourceID:   s.ID(),
				ResourceName: s.Name(),
				Status:       audit.StatusFailed,
				IP:           e.RealIP(),
				UserAgent:    e.Request.Header.Get("User-Agent"),
				Detail: map[string]any{
					"reason_code": "system_secret_delete_forbidden",
				},
			})
			return apis.NewForbiddenError("system_secret_delete_forbidden", nil)
		}
		name := s.Name()
		id := s.ID()
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
