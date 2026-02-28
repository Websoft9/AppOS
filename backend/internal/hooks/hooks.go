// Package hooks registers PocketBase event hooks for AppOS business logic.
package hooks

import (
	"fmt"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/audit"
	"github.com/websoft9/appos/backend/internal/settings"
)

// ─── File quota defaults (Story 13.2: values now stored in app_settings DB) ───────
//
// hookDefaultSpaceQuota is the code-level fallback used when the DB row is
// missing or the DB is unavailable.
var hookDefaultSpaceQuota = map[string]any{
	"maxSizeMB":           10,
	"maxPerUser":          100,
	"shareMaxMinutes":     60,
	"shareDefaultMinutes": 30,
	"maxUploadFiles":      50,
}

const (
	// Reserved root-level folder names used by the system.
	hookReservedFolderNames = "deploy,artifact"
)

// Register binds all custom event hooks to the PocketBase app.
func Register(app *pocketbase.PocketBase) {
	registerAppHooks(app)
	registerSpaceHooks(app)
	registerSuperuserHooks(app)
	registerUserAuditHooks(app)
	registerLoginAuditHooks(app)
}

// registerAppHooks registers hooks related to the apps collection.
func registerAppHooks(app *pocketbase.PocketBase) {
	// Example: auto-cleanup when an app record is deleted
	app.OnRecordAfterDeleteSuccess("apps").BindFunc(func(e *core.RecordEvent) error {
		// TODO: cleanup Docker resources, proxy config, etc.
		return e.Next()
	})

	// Example: validate app record before creation
	app.OnRecordCreate("apps").BindFunc(func(e *core.RecordEvent) error {
		// TODO: validate app configuration
		return e.Next()
	})
}

// registerSpaceHooks registers hooks related to the user_files collection.
// Enforces quota limits that cannot be expressed in PocketBase access rules.
func registerSpaceHooks(app *pocketbase.PocketBase) {
	app.OnRecordCreateRequest("user_files").BindFunc(func(e *core.RecordRequestEvent) error {
		if err := validateFileUpload(app, e.Record, e.Request.Header.Get("X-Space-Batch-Size")); err != nil {
			return apis.NewBadRequestError(err.Error(), nil)
		}
		return e.Next()
	})
}

// validateFileUpload checks file extension and per-user file count.
// For folder records (is_folder=true) format validation is skipped.
func validateFileUpload(app core.App, record *core.Record, batchSizeRaw string) error {
	// Load quota from settings DB (fallback to code defaults if unavailable).
	quota, _ := settings.GetGroup(app, "space", "quota", hookDefaultSpaceQuota)
	maxPerUser := settings.Int(quota, "maxPerUser", 100)
	maxUploadFiles := settings.Int(quota, "maxUploadFiles", 50)
	if maxUploadFiles < 1 {
		maxUploadFiles = 50
	}
	if maxUploadFiles > 200 {
		maxUploadFiles = 200
	}

	// Folders don't have a file extension — skip format check.
	if record.GetBool("is_folder") {
		// Reject reserved root-level folder names.
		parent := strings.TrimSpace(record.GetString("parent"))
		if parent == "" {
			name := strings.ToLower(strings.TrimSpace(record.GetString("name")))
			for _, reserved := range strings.Split(hookReservedFolderNames, ",") {
				if name == strings.TrimSpace(reserved) {
					return fmt.Errorf(
						"folder name %q is reserved by the system and cannot be used",
						record.GetString("name"),
					)
				}
			}
		}
		// Still enforce the count limit.
		owner := record.GetString("owner")
		if owner != "" {
			existing, err := app.FindAllRecords("user_files", dbx.HashExp{"owner": owner})
			if err == nil && len(existing) >= maxPerUser {
				return fmt.Errorf(
					"item limit reached (%d); delete some files or folders first",
					maxPerUser,
				)
			}
		}
		return nil
	}

	name := record.GetString("name")
	extToken := normalizeExtToken(strings.ToLower(path.Ext(name)))
	if extToken == "" {
		return fmt.Errorf("file extension is missing")
	}

	batchSizeRaw = strings.TrimSpace(batchSizeRaw)
	if batchSizeRaw == "" {
		return fmt.Errorf("missing X-Space-Batch-Size header")
	}
	batchSize, err := strconv.Atoi(batchSizeRaw)
	if err != nil || batchSize < 1 {
		return fmt.Errorf("invalid X-Space-Batch-Size header")
	}
	if batchSize > maxUploadFiles {
		return fmt.Errorf(
			"upload batch size %d exceeds maxUploadFiles (%d)",
			batchSize,
			maxUploadFiles,
		)
	}

	allowTokens := normalizeExtTokens(settings.StringSlice(quota, "uploadAllowExts"))
	denyTokens := normalizeExtTokens(settings.StringSlice(quota, "uploadDenyExts"))

	// Whitelist mode: when allow list is set, blacklist is ignored.
	if len(allowTokens) > 0 {
		if !slices.Contains(allowTokens, extToken) {
			return fmt.Errorf(
				"file extension %q is not in upload allowlist",
				extToken,
			)
		}
	} else {
		if slices.Contains(denyTokens, extToken) {
			return fmt.Errorf(
				"file extension %q is blocked by upload denylist",
				extToken,
			)
		}
	}

	// Check per-user file count.
	owner := record.GetString("owner")
	if owner != "" {
		existing, err := app.FindAllRecords("user_files", dbx.HashExp{"owner": owner})
		if err == nil && len(existing) >= maxPerUser {
			return fmt.Errorf(
				"file limit reached (%d); delete some files before uploading new ones",
				maxPerUser,
			)
		}
	}
	return nil
}

func normalizeExtToken(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	v = strings.TrimPrefix(v, ".")
	if v == "python" {
		return "py"
	}
	return v
}

func normalizeExtTokens(values []string) []string {
	out := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, v := range values {
		token := normalizeExtToken(v)
		if token == "" || seen[token] {
			continue
		}
		seen[token] = true
		out = append(out, token)
	}
	return out
}

// registerUserAuditHooks writes audit records when users are created, updated, or deleted
// via PocketBase's built-in REST API (not the custom /api/ext/users routes).
// Both the "users" and "_superusers" collections are tracked.
// Uses request-level hooks to access e.Auth (the actor performing the operation).
func registerUserAuditHooks(app *pocketbase.PocketBase) {
	actorInfo := func(auth *core.Record) (string, string) {
		if auth != nil {
			return auth.Id, auth.GetString("email")
		}
		return "system", ""
	}

	for _, col := range []string{"users", "_superusers"} {
		col := col // capture loop variable

		app.OnRecordCreateRequest(col).BindFunc(func(e *core.RecordRequestEvent) error {
			err := e.Next()
			if err == nil {
				userID, userEmail := actorInfo(e.Auth)
				audit.Write(app, audit.Entry{
					UserID: userID, UserEmail: userEmail,
					Action: "user.create", ResourceType: "user",
					ResourceID: e.Record.Id, ResourceName: e.Record.GetString("email"),
					Status:    audit.StatusSuccess,
					IP:        e.RealIP(),
					UserAgent: e.Request.Header.Get("User-Agent"),
				})
			}
			return err
		})

		app.OnRecordUpdateRequest(col).BindFunc(func(e *core.RecordRequestEvent) error {
			err := e.Next()
			if err == nil {
				userID, userEmail := actorInfo(e.Auth)
				audit.Write(app, audit.Entry{
					UserID: userID, UserEmail: userEmail,
					Action: "user.update", ResourceType: "user",
					ResourceID: e.Record.Id, ResourceName: e.Record.GetString("email"),
					Status:    audit.StatusSuccess,
					IP:        e.RealIP(),
					UserAgent: e.Request.Header.Get("User-Agent"),
				})
			}
			return err
		})

		app.OnRecordDeleteRequest(col).BindFunc(func(e *core.RecordRequestEvent) error {
			// Capture record info before deletion
			recordID := e.Record.Id
			recordEmail := e.Record.GetString("email")
			ip := e.RealIP()
			ua := e.Request.Header.Get("User-Agent")
			err := e.Next()
			if err == nil {
				userID, userEmail := actorInfo(e.Auth)
				audit.Write(app, audit.Entry{
					UserID: userID, UserEmail: userEmail,
					Action: "user.delete", ResourceType: "user",
					ResourceID: recordID, ResourceName: recordEmail,
					Status:    audit.StatusSuccess,
					IP:        ip,
					UserAgent: ua,
				})
			}
			return err
		})
	}
}

// registerLoginAuditHooks writes audit records on login success and failure
// for both the "users" and "_superusers" collections.
func registerLoginAuditHooks(app *pocketbase.PocketBase) {
	for _, col := range []string{"users", "_superusers"} {
		col := col // capture loop variable

		app.OnRecordAuthWithPasswordRequest(col).BindFunc(func(e *core.RecordAuthWithPasswordRequestEvent) error {
			ip := e.RealIP()
			ua := e.Request.Header.Get("User-Agent")
			err := e.Next()
			if err != nil {
				audit.Write(app, audit.Entry{
					UserID: "unknown", UserEmail: e.Identity,
					Action: "login.failed", ResourceType: "session",
					Status:    audit.StatusFailed,
					IP:        ip,
					UserAgent: ua,
					Detail: map[string]any{
						"reason":     err.Error(),
						"collection": col,
					},
				})
				return err
			}
			audit.Write(app, audit.Entry{
				UserID: e.Record.Id, UserEmail: e.Record.GetString("email"),
				Action: "login.success", ResourceType: "session",
				Status:    audit.StatusSuccess,
				IP:        ip,
				UserAgent: ua,
			})
			return nil
		})
	}
}

// registerSuperuserHooks registers safety guards for the _superusers system collection.
func registerSuperuserHooks(app *pocketbase.PocketBase) {
	// Guard: prevent deleting self or the last superuser.
	// Uses OnRecordDeleteRequest (request-level hook) to access the auth record.
	app.OnRecordDeleteRequest("_superusers").BindFunc(func(e *core.RecordRequestEvent) error {
		// Guard 1: cannot delete yourself.
		if e.Auth != nil && e.Auth.Id == e.Record.Id {
			return apis.NewBadRequestError("cannot_delete_self", nil)
		}

		// Guard 2: cannot delete the last superuser.
		count, err := app.CountRecords("_superusers")
		if err != nil {
			return fmt.Errorf("superuser guard: failed to count superusers: %w", err)
		}
		if count <= 1 {
			return apis.NewBadRequestError("cannot_delete_last_superuser", nil)
		}

		return e.Next()
	})
}
