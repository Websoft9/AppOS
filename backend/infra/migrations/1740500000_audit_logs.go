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
			Values:    []string{"pending", "success", "failed", "attention_required"},
		})
		col.Fields.Add(&core.TextField{Name: "ip"})
		col.Fields.Add(&core.JSONField{Name: "detail"})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})

		rule := "user_id = @request.auth.id || @request.auth.collectionName = '_superusers'"
		col.ListRule = &rule
		col.ViewRule = &rule
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Indexes = []string{
			"CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id)",
			"CREATE INDEX idx_audit_logs_action ON audit_logs (action)",
		}

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("audit_logs")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}