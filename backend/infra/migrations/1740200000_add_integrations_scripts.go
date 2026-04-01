package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

// Epic 8 addendum: add integrations and scripts collections.
//
//  8. integrations (→ secrets)
//  9. scripts      (no deps)
func init() {
	m.Register(func(app core.App) error {
		// Look up secrets collection for relation fields
		secretsCol, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		// ─── 8. integrations ─────────────────────────────────
		integrations := core.NewBaseCollection("integrations")
		integrations.ListRule = types.Pointer("@request.auth.id != ''")
		integrations.ViewRule = types.Pointer("@request.auth.id != ''")
		integrations.CreateRule = nil
		integrations.UpdateRule = nil
		integrations.DeleteRule = nil

		integrations.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		integrations.Fields.Add(&core.SelectField{
			Name:      "type",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"rest", "webhook", "mcp"},
		})
		integrations.Fields.Add(&core.TextField{
			Name:     "url",
			Required: true,
		})
		integrations.Fields.Add(&core.SelectField{
			Name:      "auth_type",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"none", "api_key", "bearer", "basic"},
		})
		integrations.Fields.Add(&core.RelationField{
			Name:         "credential",
			CollectionId: secretsCol.Id,
			MaxSelect:    1,
		})
		integrations.Fields.Add(&core.JSONField{
			Name:    "extra",
			MaxSize: 1 << 20, // 1MB
		})
		integrations.Fields.Add(&core.TextField{
			Name: "description",
		})
		integrations.AddIndex("idx_integrations_name", true, "name", "")

		if err := app.Save(integrations); err != nil {
			return err
		}

		// ─── 9. scripts ──────────────────────────────────────
		scripts := core.NewBaseCollection("scripts")
		scripts.ListRule = types.Pointer("@request.auth.id != ''")
		scripts.ViewRule = types.Pointer("@request.auth.id != ''")
		scripts.CreateRule = nil
		scripts.UpdateRule = nil
		scripts.DeleteRule = nil

		scripts.Fields.Add(&core.TextField{
			Name:     "name",
			Required: true,
			Max:      200,
		})
		scripts.Fields.Add(&core.SelectField{
			Name:      "language",
			Required:  true,
			MaxSelect: 1,
			Values:    []string{"python3", "bash"},
		})
		scripts.Fields.Add(&core.TextField{
			Name:     "code",
			Required: true,
		})
		scripts.Fields.Add(&core.TextField{
			Name: "description",
		})
		scripts.AddIndex("idx_scripts_name", true, "name", "")

		return app.Save(scripts)
	}, func(app core.App) error {
		// Down: delete in reverse order
		for _, name := range []string{"scripts", "integrations"} {
			col, err := app.FindCollectionByNameOrId(name)
			if err != nil {
				continue
			}
			if err := app.Delete(col); err != nil {
				return err
			}
		}
		return nil
	})
}
