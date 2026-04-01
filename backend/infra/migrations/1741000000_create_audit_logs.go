package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

// Story 12.1: Create audit_logs BaseCollection for operation audit log.
//
// Access rules:
//   - List/View: owner or superuser only
//   - Create/Update/Delete: forbidden (all writes go through audit.Write on the backend)
func init() {
	m.Register(func(app core.App) error {
		col := core.NewBaseCollection("audit_logs")

		col.Fields.Add(&core.TextField{Name: "user_id", Required: true})
		col.Fields.Add(&core.TextField{Name: "user_email"})
		col.Fields.Add(&core.TextField{Name: "action", Required: true})
		col.Fields.Add(&core.TextField{Name: "resource_type"})
		col.Fields.Add(&core.TextField{Name: "resource_id"})
		col.Fields.Add(&core.TextField{Name: "resource_name"})
		col.Fields.Add(&core.SelectField{
			Name:      "status",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"pending", "success", "failed"},
		})
		col.Fields.Add(&core.TextField{Name: "ip"})
		col.Fields.Add(&core.JSONField{Name: "detail"})
		// BaseCollection does NOT include created/updated by default — add explicitly.
		col.Fields.Add(&core.AutodateField{
			Name:     "created",
			OnCreate: true,
		})
		col.Fields.Add(&core.AutodateField{
			Name:     "updated",
			OnCreate: true,
			OnUpdate: true,
		})

		// List/View: owner or any superuser.
		// collectionName is the portable filter syntax supported by PocketBase.
		rule := "user_id = @request.auth.id || @request.auth.collectionName = '_superusers'"
		col.ListRule = &rule
		col.ViewRule = &rule

		// Create/Update/Delete: nil = no rule = forbidden for BaseCollection
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		// Indices for common query patterns.
		// Note: `created` and `updated` are managed by PocketBase internally and
		// cannot be referenced in custom Indexes at collection-save time.
		col.Indexes = []string{
			"CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id)",
			"CREATE INDEX idx_audit_logs_action ON audit_logs (action)",
		}

		return app.Save(col)
	}, func(app core.App) error {
		// Down: remove the collection
		col, err := app.FindCollectionByNameOrId("audit_logs")
		if err != nil {
			return nil // already gone
		}
		return app.Delete(col)
	})
}
