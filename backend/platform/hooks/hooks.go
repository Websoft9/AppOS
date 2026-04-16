// Package hooks registers PocketBase event hooks for AppOS business logic.
package hooks

import (
	"fmt"
	"path"
	"strconv"
	"strings"

	"github.com/hibiken/asynq"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/certs"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/space"
)

// Register binds all custom event hooks to the PocketBase app.
func Register(app *pocketbase.PocketBase, asynqClient *asynq.Client) {
	registerAppHooks(app)
	registerCronHooks(app, asynqClient)
	registerSpaceHooks(app)
	registerSuperuserHooks(app)
	registerUserAuditHooks(app)
	registerLoginAuditHooks(app)
	registerEnvSetHooks(app)
	secrets.RegisterHooks(app)
	certs.RegisterHooks(app)
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
	quota := space.GetQuota(app)

	// Folders don't have a file extension — skip format check.
	if record.GetBool("is_folder") {
		// Reject reserved root-level folder names.
		parent := strings.TrimSpace(record.GetString("parent"))
		if parent == "" {
			if space.IsReservedRootFolderName(record.GetString("name"), quota.DisallowedFolderNames) {
				return fmt.Errorf(
					"folder name %q is reserved by the system and cannot be used",
					record.GetString("name"),
				)
			}
		}
		// Still enforce the count limit.
		owner := record.GetString("owner")
		if owner != "" {
			existing, err := app.FindAllRecords(space.Collection, dbx.HashExp{"owner": owner})
			if err == nil {
				if countErr := space.ValidateItemCount(len(existing), quota.MaxPerUser); countErr != nil {
					return countErr
				}
			}
		}
		return nil
	}

	name := record.GetString("name")
	extToken := space.NormalizeExt(path.Ext(name))
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
	if batchSize > quota.MaxUploadFiles {
		return fmt.Errorf(
			"upload batch size %d exceeds maxUploadFiles (%d)",
			batchSize,
			quota.MaxUploadFiles,
		)
	}

	if err := space.ValidateExt(quota, extToken); err != nil {
		return err
	}

	// Check per-user file count.
	owner := record.GetString("owner")
	if owner != "" {
		existing, err := app.FindAllRecords(space.Collection, dbx.HashExp{"owner": owner})
		if err == nil {
			if countErr := space.ValidateItemCount(len(existing), quota.MaxPerUser); countErr != nil {
				return countErr
			}
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

// registerEnvSetHooks registers safety guards for the env_sets collection.
func registerEnvSetHooks(app *pocketbase.PocketBase) {
	// Guard: prevent deleting an env_set that still has child variables.
	app.OnRecordDeleteRequest("env_sets").BindFunc(func(e *core.RecordRequestEvent) error {
		count, err := app.CountRecords("env_set_vars",
			dbx.HashExp{"set": e.Record.Id},
		)
		if err != nil {
			return fmt.Errorf("env_set guard: failed to count variables: %w", err)
		}
		if count > 0 {
			return apis.NewBadRequestError(
				fmt.Sprintf("cannot delete env set: remove its %d variable(s) first", count),
				nil,
			)
		}
		return e.Next()
	})
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
