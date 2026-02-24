// Package hooks registers PocketBase event hooks for AppOS business logic.
package hooks

import (
	"fmt"
	"path"
	"slices"
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
}

const (
	// Reserved root-level folder names used by the system.
	hookReservedFolderNames = "deploy,artifact"
	// Must match spaceAllowedUploadFormats in routes/space.go.
	hookSpaceAllowedFormats = "txt,md,yaml,yml,json,sh,bash,zsh,fish,env," +
		"js,ts,jsx,tsx,mjs,cjs,vue,svelte," +
		"py,rb,go,rs,java,c,cpp,h,hpp,cc,cs,php,swift,kt,scala,groovy,lua,r,m,pl,pm," +
		"ex,exs,erl,hrl,clj,cljs,fs,fsx,ml,mli," +
		"css,scss,sass,less,html,htm,xml,svg,sql,graphql," +
		"toml,ini,cfg,conf,properties,gitignore,dockerignore,makefile,cmake," +
		"editorconfig,log,diff,patch,lock," +
		"pdf,doc,docx,xls,xlsx,ppt,pptx,odt,ods,odp"
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
	app.OnRecordCreate("user_files").BindFunc(func(e *core.RecordEvent) error {
		if err := validateFileUpload(app, e.Record); err != nil {
			return apis.NewBadRequestError(err.Error(), nil)
		}
		return e.Next()
	})
}

// validateFileUpload checks file extension and per-user file count.
// For folder records (is_folder=true) format validation is skipped.
func validateFileUpload(app core.App, record *core.Record) error {
	// Load quota from settings DB (fallback to code defaults if unavailable).
	quota, _ := settings.GetGroup(app, "space", "quota", hookDefaultSpaceQuota)
	maxPerUser := settings.Int(quota, "maxPerUser", 100)

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
	ext := strings.ToLower(path.Ext(name))

	// Build allowed extension list.
	allowed := make([]string, 0)
	for _, p := range strings.Split(hookSpaceAllowedFormats, ",") {
		if p = strings.TrimSpace(p); p != "" {
			allowed = append(allowed, "."+p)
		}
	}
	if ext == "" || !slices.Contains(allowed, ext) {
		return fmt.Errorf(
			"file extension %q is not allowed; permitted: %s",
			ext, hookSpaceAllowedFormats,
		)
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
