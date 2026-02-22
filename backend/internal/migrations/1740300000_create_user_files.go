package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Epic 9: creates the user_files collection.
//
// Each record represents one file owned by a single authenticated user.
// Files are stored via PocketBase's file field (local or S3 storage).
// Sharing is controlled by share_token + share_expires_at (no is_public flag needed).
//
// Access rules: owner-scoped — every operation requires owner = @request.auth.id.
// Quota enforcement is handled at the application layer (ext handler + hook).
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("user_files")

		// ─── Access rules (owner-scoped) ──────────────────────
		ownerRule := "owner = @request.auth.id"
		col.ListRule = types.Pointer(ownerRule)
		col.ViewRule = types.Pointer(ownerRule)
		col.CreateRule = types.Pointer(ownerRule)
		col.UpdateRule = types.Pointer(ownerRule)
		col.DeleteRule = types.Pointer(ownerRule)

		// ─── Fields ───────────────────────────────────────────

		// Owner: stores the authenticated user's ID (string, not a relation,
		// to avoid coupling to a specific auth collection).
		col.Fields.Add(&core.TextField{
			Name:     "owner",
			Required: true,
			Max:      64,
		})

		// Display name shown in the UI (e.g. "notes.md").
		col.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      500,
		})

		// Actual file stored in PocketBase storage.
		// MaxSize is set to the hard upper limit (100 MB); the configurable
		// soft limit is enforced at the ext handler / hook layer.
		// TODO (Story 9.5): read MaxSize from settings API (Epic 2).
		col.Fields.Add(&core.FileField{
			Name:      "content",
			MaxSelect: 1,
			MaxSize:   100 * 1024 * 1024, // 100 MB hard cap
		})

		// MIME type of the uploaded file (e.g. "text/plain", "text/markdown").
		col.Fields.Add(&core.TextField{
			Name: "mime_type",
			Max:  200,
		})

		// Platform share token — empty string means "not shared".
		// Set by POST /api/ext/files/share/{id}.
		col.Fields.Add(&core.TextField{
			Name: "share_token",
			Max:  128,
		})

		// Share expiration timestamp (RFC3339). Empty means no active share.
		col.Fields.Add(&core.TextField{
			Name: "share_expires_at",
			Max:  64,
		})

		// Autodate fields — PocketBase base collections do NOT include
		// created/updated by default; we add them explicitly.
		col.Fields.Add(&core.AutodateField{
			Name:     "created",
			OnCreate: true,
		})
		col.Fields.Add(&core.AutodateField{
			Name:     "updated",
			OnCreate: true,
			OnUpdate: true,
		})

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("user_files")
		if err != nil {
			return nil // already removed
		}
		return app.Delete(col)
	})
}
