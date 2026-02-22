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
)

// ─── File quota constants (mirrors routes/files.go) ─────────────────────────
// TODO (Story 9.5): replace with live settings API lookups (Epic 2).
const (
	hookFilesMaxPerUser = 100

	// Reserved root-level folder names used by the system.
	// TODO (Story 9.5): make configurable via settings API.
	hookReservedFolderNames = "deploy,artifact"
	// Must match filesAllowedUploadFormats in routes/files.go.
	hookFilesAllowedFormats = "txt,md,yaml,yml,json,sh,bash,zsh,fish,env," +
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
	registerFileHooks(app)
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

// registerFileHooks registers hooks related to the user_files collection.
// Enforces quota limits that cannot be expressed in PocketBase access rules.
func registerFileHooks(app *pocketbase.PocketBase) {
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
			if err == nil && len(existing) >= hookFilesMaxPerUser {
				return fmt.Errorf(
					"item limit reached (%d); delete some files or folders first",
					hookFilesMaxPerUser,
				)
			}
		}
		return nil
	}

	name := record.GetString("name")
	ext := strings.ToLower(path.Ext(name))

	// Build allowed extension list.
	allowed := make([]string, 0)
	for _, p := range strings.Split(hookFilesAllowedFormats, ",") {
		if p = strings.TrimSpace(p); p != "" {
			allowed = append(allowed, "."+p)
		}
	}
	if ext == "" || !slices.Contains(allowed, ext) {
		return fmt.Errorf(
			"file extension %q is not allowed; permitted: %s",
			ext, hookFilesAllowedFormats,
		)
	}

	// Check per-user file count.
	owner := record.GetString("owner")
	if owner != "" {
		existing, err := app.FindAllRecords("user_files", dbx.HashExp{"owner": owner})
		if err == nil && len(existing) >= hookFilesMaxPerUser {
			return fmt.Errorf(
				"file limit reached (%d); delete some files before uploading new ones",
				hookFilesMaxPerUser,
			)
		}
	}
	return nil
}
