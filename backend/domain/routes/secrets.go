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
		s := secrets.From(rec)
		if !s.IsOwnedBy(e.Auth) {
			return apis.NewForbiddenError("forbidden", nil)
		}
		if s.IsRevoked() {
			return apis.NewForbiddenError("revoked secret payload cannot be updated", nil)
		}
		if s.IsSystemManaged() {
			writeSystemSecretDeniedAudit(e, s, "secret.payload_update_denied", "system_secret_payload_read_only")
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
			txSecret := secrets.From(txRec)
			if txRec.GetInt("version") != baseVersion {
				return apis.NewBadRequestError("version conflict, retry with latest data", nil)
			}
			if txSecret.IsRevoked() {
				return apis.NewForbiddenError("revoked secret payload cannot be updated", nil)
			}
			if txSecret.IsSystemManaged() {
				writeSystemSecretDeniedAudit(e, txSecret, "secret.payload_update_denied", "system_secret_payload_read_only")
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

		result, err := secrets.Resolve(e.App, body.SecretID, strings.TrimSpace(body.UsedBy))
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

		resp := map[string]any{"payload": result.Payload}
		if result.ExpiresAt != "" {
			resp["expires_at"] = result.ExpiresAt
			resp["is_expired"] = result.IsExpired
		}
		return e.JSON(http.StatusOK, resp)
	})

	reveal := secretsGroup.Group("/{id}/reveal")
	reveal.Bind(apis.RequireAuth())
	reveal.GET("", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")

		result, err := secrets.RevealPayload(e.App, id, e.Auth)
		if err != nil {
			msg := err.Error()
			switch {
			case strings.Contains(msg, "reveal_disabled"):
				return apis.NewForbiddenError("Secret reveal is disabled by administrator", nil)
			case strings.Contains(msg, "not_found"):
				return apis.NewNotFoundError("secret not found", nil)
			case strings.Contains(msg, "forbidden"):
				return apis.NewForbiddenError("forbidden", nil)
			case strings.Contains(msg, "revoked"):
				return apis.NewForbiddenError("secret is revoked", nil)
			case strings.Contains(msg, "reveal_not_allowed"):
				return apis.NewForbiddenError("reveal disabled", nil)
			case strings.Contains(msg, "decrypt_failed"):
				return apis.NewBadRequestError("decrypt failed", err)
			default:
				return apis.NewBadRequestError("reveal failed", err)
			}
		}

		audit.Write(e.App, audit.Entry{
			UserID:       e.Auth.Id,
			UserEmail:    e.Auth.GetString("email"),
			Action:       "secret.reveal",
			ResourceType: "secret",
			ResourceID:   result.RecordID,
			ResourceName: result.RecordName,
			Status:       audit.StatusSuccess,
			IP:           e.RealIP(),
			UserAgent:    e.Request.Header.Get("User-Agent"),
		})

		return e.JSON(http.StatusOK, map[string]any{"payload": result.Payload})
	})
}

func isPrivateIP(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	return parsed.IsLoopback() || parsed.IsPrivate()
}

func writeSystemSecretDeniedAudit(e *core.RequestEvent, secret *secrets.Secret, action string, reasonCode string) {
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
		ResourceID:   secret.ID(),
		ResourceName: secret.Name(),
		Status:       audit.StatusFailed,
		IP:           e.RealIP(),
		UserAgent:    e.Request.Header.Get("User-Agent"),
		Detail: map[string]any{
			"reason_code": reasonCode,
		},
	})
}
