package routes

import (
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/secrets"
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

		enc, err := secrets.EncryptPayload(body.Payload)
		if err != nil {
			return e.InternalServerError("encrypt failed", err)
		}
		rec.Set("payload_encrypted", enc)
		rec.Set("payload_meta", secrets.BuildPayloadMeta(body.Payload, tpl))
		rec.Set("version", rec.GetInt("version")+1)

		if err := e.App.Save(rec); err != nil {
			return e.BadRequestError("failed to save", err)
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

		return e.JSON(http.StatusOK, map[string]any{"ok": true, "version": rec.GetInt("version")})
	}).Bind(apis.RequireAuth())

	secretsGroup.POST("/resolve", func(e *core.RequestEvent) error {
		if e.Request.Header.Get("X-Appos-Internal") != "1" || !isPrivateIP(e.RealIP()) {
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

		rec, err := e.App.FindRecordById("secrets", body.SecretID)
		if err != nil {
			return e.NotFoundError("secret not found", err)
		}
		if rec.GetString("status") == "revoked" {
			return apis.NewForbiddenError("secret is revoked", nil)
		}

		payload, err := secrets.DecryptPayload(rec.GetString("payload_encrypted"))
		if err != nil {
			return e.InternalServerError("decrypt failed", err)
		}

		rec.Set("last_used_at", time.Now().UTC().Format(time.RFC3339))
		rec.Set("last_used_by", strings.TrimSpace(body.UsedBy))
		if err := e.App.Save(rec); err != nil {
			log.Printf("[WARN] secrets/resolve: failed to update last_used fields for %s: %v", rec.Id, err)
		}

		audit.Write(e.App, audit.Entry{
			UserID:       "system",
			Action:       "secret.use",
			ResourceType: "secret",
			ResourceID:   rec.Id,
			ResourceName: rec.GetString("name"),
			Status:       audit.StatusSuccess,
			IP:           e.RealIP(),
			UserAgent:    e.Request.Header.Get("User-Agent"),
		})

		return e.JSON(http.StatusOK, map[string]any{"payload": payload})
	})

	reveal := secretsGroup.Group("/{id}/reveal")
	reveal.Bind(apis.RequireAuth())
	reveal.GET("", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")

		var decryptedPayload map[string]any
		var recordID, recordName string

		txErr := e.App.RunInTransaction(func(txApp core.App) error {
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
