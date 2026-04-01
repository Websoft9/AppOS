package routes

import (
	"errors"
	"net"
	"net/http"
	"os"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/secrets"
)

func registerSecretsRoutes(se *core.ServeEvent) {
	registerSecretsGroup(se.Router.Group("/api/secrets"))
}

func registerSecretsGroup(secretsGroup *router.RouterGroup[*core.RequestEvent]) {

	secretsGroup.GET("/templates", func(e *core.RequestEvent) error {
		if e.Auth == nil {
			return apis.NewUnauthorizedError("authentication required", nil)
		}
		return e.JSON(http.StatusOK, secrets.Templates())
	}).Bind(apis.RequireAuth())

	secretsGroup.PUT("/{id}/payload", func(e *core.RequestEvent) error {
		if e.Auth == nil {
			return apis.NewUnauthorizedError("authentication required", nil)
		}
		id := e.Request.PathValue("id")
		rec, err := e.App.FindRecordById("secrets", id)
		if err != nil {
			return e.NotFoundError("secret not found", err)
		}
		if !isSecretOwnerOrSuperuser(e.Auth, rec) {
			return apis.NewForbiddenError("forbidden", nil)
		}
		if rec.GetString("status") == "revoked" {
			return apis.NewForbiddenError("revoked secret payload cannot be updated", nil)
		}
		if isSystemManagedSecretRecord(rec) {
			writeSystemSecretDeniedAudit(e, rec, "secret.payload_update_denied", "system_secret_payload_read_only")
			return apis.NewForbiddenError("system_secret_payload_read_only", nil)
		}

		baseVersion := rec.GetInt("version")

		var body struct {
			Payload map[string]any `json:"payload"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("invalid body", err)
		}
		if body.Payload == nil {
			return e.BadRequestError("payload is required", nil)
		}

		tpl, ok := secrets.FindTemplate(rec.GetString("template_id"))
		if !ok {
			return e.BadRequestError("invalid template_id", nil)
		}

		if err := secrets.ValidatePayload(body.Payload, tpl); err != nil {
			return e.BadRequestError(err.Error(), nil)
		}

		enc, err := secrets.EncryptPayload(body.Payload)
		if err != nil {
			return e.InternalServerError("encrypt failed", err)
		}

		newVersion := 0
		txErr := e.App.RunInTransaction(func(txApp core.App) error {
			txRec, findErr := txApp.FindRecordById("secrets", id)
			if findErr != nil {
				return apis.NewNotFoundError("secret not found", findErr)
			}
			if txRec.GetInt("version") != baseVersion {
				return apis.NewBadRequestError("version conflict, retry with latest data", nil)
			}
			if txRec.GetString("status") == "revoked" {
				return apis.NewForbiddenError("revoked secret payload cannot be updated", nil)
			}
			if isSystemManagedSecretRecord(txRec) {
				writeSystemSecretDeniedAudit(e, txRec, "secret.payload_update_denied", "system_secret_payload_read_only")
				return apis.NewForbiddenError("system_secret_payload_read_only", nil)
			}

			txRec.Set("payload_encrypted", enc)
			txRec.Set("payload_meta", secrets.BuildPayloadMeta(body.Payload, tpl))
			txRec.Set("version", txRec.GetInt("version")+1)

			if saveErr := txApp.Save(txRec); saveErr != nil {
				return apis.NewBadRequestError("failed to save", saveErr)
			}
			newVersion = txRec.GetInt("version")
			return nil
		})
		if txErr != nil {
			return txErr
		}

		audit.Write(e.App, audit.Entry{
			UserID:       e.Auth.Id,
			UserEmail:    e.Auth.GetString("email"),
			Action:       "secret.payload_update",
			ResourceType: "secret",
			ResourceID:   rec.Id,
			ResourceName: rec.GetString("name"),
			Status:       audit.StatusSuccess,
			IP:           e.RealIP(),
			UserAgent:    e.Request.Header.Get("User-Agent"),
		})

		return e.JSON(http.StatusOK, map[string]any{"ok": true, "version": newVersion})
	}).Bind(apis.RequireAuth())

	secretsGroup.POST("/resolve", func(e *core.RequestEvent) error {
		internalToken := strings.TrimSpace(os.Getenv("APPOS_INTERNAL_TOKEN"))
		if internalToken == "" {
			return apis.NewForbiddenError("internal token is not configured", nil)
		}

		// Use the TCP-level RemoteAddr to avoid X-Forwarded-For / X-Real-IP spoofing.
		remoteHost, _, splitErr := net.SplitHostPort(e.Request.RemoteAddr)
		if splitErr != nil {
			remoteHost = e.Request.RemoteAddr
		}
		if e.Request.Header.Get("X-Appos-Internal") != "1" || !isPrivateIP(remoteHost) {
			return apis.NewForbiddenError("internal access only", nil)
		}
		if e.Request.Header.Get("X-Appos-Internal-Token") != internalToken {
			return apis.NewForbiddenError("internal access only", nil)
		}

		var body struct {
			SecretID string `json:"secret_id"`
			UsedBy   string `json:"used_by"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("invalid body", err)
		}
		if strings.TrimSpace(body.SecretID) == "" {
			return e.BadRequestError("secret_id is required", nil)
		}

		payload, err := secrets.Resolve(e.App, body.SecretID, strings.TrimSpace(body.UsedBy))
		if err != nil {
			var resolveErr *secrets.ResolveError
			if errors.As(err, &resolveErr) {
				reason := strings.ToLower(resolveErr.Reason)
				switch {
				case strings.Contains(reason, "not found"):
					return e.NotFoundError("secret not found", err)
				case strings.Contains(reason, "revoked"):
					return apis.NewForbiddenError("secret is revoked", nil)
				case strings.Contains(reason, "no payload"):
					return e.BadRequestError("secret has no payload", nil)
				}
			}
			return e.InternalServerError("resolve failed", err)
		}

		return e.JSON(http.StatusOK, map[string]any{"payload": payload})
	})

	reveal := secretsGroup.Group("/{id}/reveal")
	reveal.Bind(apis.RequireAuth())
	reveal.GET("", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")

		var decryptedPayload map[string]any
		var recordID, recordName string

		txErr := e.App.RunInTransaction(func(txApp core.App) error {
			policy := secrets.GetPolicy(txApp)
			if policy.RevealDisabled {
				return apis.NewForbiddenError("Secret reveal is disabled by administrator", nil)
			}

			rec, err := txApp.FindRecordById("secrets", id)
			if err != nil {
				return apis.NewNotFoundError("secret not found", err)
			}
			if !isSecretOwnerOrSuperuser(e.Auth, rec) {
				return apis.NewForbiddenError("forbidden", nil)
			}
			if rec.GetString("status") == "revoked" {
				return apis.NewForbiddenError("secret is revoked", nil)
			}
			mode := rec.GetString("access_mode")
			if mode == "use_only" {
				return apis.NewForbiddenError("reveal disabled", nil)
			}

			payload, err := secrets.DecryptPayload(rec.GetString("payload_encrypted"))
			if err != nil {
				return apis.NewBadRequestError("decrypt failed", err)
			}

			if mode == "reveal_once" {
				rec.Set("access_mode", "use_only")
				if err := txApp.Save(rec); err != nil {
					return apis.NewBadRequestError("failed to update access mode", err)
				}
			}

			decryptedPayload = payload
			recordID = rec.Id
			recordName = rec.GetString("name")
			return nil
		})
		if txErr != nil {
			return txErr
		}

		audit.Write(e.App, audit.Entry{
			UserID:       e.Auth.Id,
			UserEmail:    e.Auth.GetString("email"),
			Action:       "secret.reveal",
			ResourceType: "secret",
			ResourceID:   recordID,
			ResourceName: recordName,
			Status:       audit.StatusSuccess,
			IP:           e.RealIP(),
			UserAgent:    e.Request.Header.Get("User-Agent"),
		})

		return e.JSON(http.StatusOK, map[string]any{"payload": decryptedPayload})
	})
}

func isSecretOwnerOrSuperuser(auth *core.Record, secret *core.Record) bool {
	if auth == nil {
		return false
	}
	if auth.Collection().Name == core.CollectionNameSuperusers {
		return true
	}
	return secret.GetString("created_by") == auth.Id
}

func isPrivateIP(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	return parsed.IsLoopback() || parsed.IsPrivate()
}

func isSystemManagedSecretRecord(secret *core.Record) bool {
	if secret == nil {
		return false
	}
	if secret.GetString("created_source") == "system" {
		return true
	}
	return secret.GetString("type") == "tunnel_token"
}

func writeSystemSecretDeniedAudit(e *core.RequestEvent, secret *core.Record, action string, reasonCode string) {
	if e == nil || secret == nil {
		return
	}
	userID := ""
	userEmail := ""
	if e.Auth != nil {
		userID = e.Auth.Id
		userEmail = e.Auth.GetString("email")
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       action,
		ResourceType: "secret",
		ResourceID:   secret.Id,
		ResourceName: secret.GetString("name"),
		Status:       audit.StatusFailed,
		IP:           e.RealIP(),
		UserAgent:    e.Request.Header.Get("User-Agent"),
		Detail: map[string]any{
			"reason_code": reasonCode,
		},
	})
}
