package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		secrets, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		col := core.NewBaseCollection("certificates")
		col.ListRule = types.Pointer("@request.auth.id != ''")
		col.ViewRule = types.Pointer("@request.auth.id != ''")
		col.CreateRule = nil
		col.UpdateRule = nil
		col.DeleteRule = nil

		col.Fields.Add(&core.TextField{Name: "name", Required: true, Max: 200})
		col.Fields.Add(&core.TextField{Name: "domain"})
		col.Fields.Add(&core.TextField{Name: "template_id", Max: 120})
		col.Fields.Add(&core.SelectField{Name: "kind", MaxSelect: 1, Values: []string{"self_signed", "ca_issued"}})
		col.Fields.Add(&core.TextField{Name: "cert_pem"})
		col.Fields.Add(&core.RelationField{Name: "key", CollectionId: secrets.Id, MaxSelect: 1})
		col.Fields.Add(&core.RelationField{Name: "private_key_secret", CollectionId: secrets.Id, MaxSelect: 1})
		col.Fields.Add(&core.TextField{Name: "issuer"})
		col.Fields.Add(&core.TextField{Name: "subject"})
		col.Fields.Add(&core.DateField{Name: "expires_at"})
		col.Fields.Add(&core.DateField{Name: "issued_at"})
		col.Fields.Add(&core.TextField{Name: "serial_number"})
		col.Fields.Add(&core.TextField{Name: "signature_algorithm"})
		col.Fields.Add(&core.NumberField{Name: "key_bits", OnlyInt: true})
		col.Fields.Add(&core.NumberField{Name: "cert_version", OnlyInt: true})
		col.Fields.Add(&core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"active", "expired", "revoked"}})
		col.Fields.Add(&core.BoolField{Name: "auto_renew"})
		col.Fields.Add(&core.TextField{Name: "description"})
		col.Fields.Add(&core.AutodateField{Name: "created", OnCreate: true})
		col.Fields.Add(&core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		col.AddIndex("idx_certificates_name", true, "name", "")
		col.AddIndex("idx_certificates_domain", false, "domain", "")

		return app.Save(col)
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("certificates")
		if err != nil {
			return nil
		}
		return app.Delete(col)
	})
}