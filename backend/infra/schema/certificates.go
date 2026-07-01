package schema

import "github.com/pocketbase/pocketbase/core"

func EnsureCertificatesCollection(app core.App) error {
	secrets, err := app.FindCollectionByNameOrId("secrets")
	if err != nil {
		return err
	}
	col, err := app.FindCollectionByNameOrId("certificates")
	if err != nil {
		col = core.NewBaseCollection("certificates")
	}
	col.ListRule = authenticatedRule()
	col.ViewRule = authenticatedRule()
	col.CreateRule = nil
	col.UpdateRule = nil
	col.DeleteRule = nil
	addFieldIfMissing(col, &core.TextField{Name: "name", Required: true, Max: 200})
	addFieldIfMissing(col, &core.TextField{Name: "domain"})
	addFieldIfMissing(col, &core.TextField{Name: "template_id", Max: 120})
	addFieldIfMissing(col, &core.SelectField{Name: "kind", MaxSelect: 1, Values: []string{"self_signed", "ca_issued"}})
	addFieldIfMissing(col, &core.TextField{Name: "cert_pem"})
	addFieldIfMissing(col, &core.RelationField{Name: "key", CollectionId: secrets.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.RelationField{Name: "private_key_secret", CollectionId: secrets.Id, MaxSelect: 1})
	addFieldIfMissing(col, &core.TextField{Name: "issuer"})
	addFieldIfMissing(col, &core.TextField{Name: "subject"})
	addFieldIfMissing(col, &core.DateField{Name: "expires_at"})
	addFieldIfMissing(col, &core.DateField{Name: "issued_at"})
	addFieldIfMissing(col, &core.TextField{Name: "serial_number"})
	addFieldIfMissing(col, &core.TextField{Name: "signature_algorithm"})
	addFieldIfMissing(col, &core.NumberField{Name: "key_bits", OnlyInt: true})
	addFieldIfMissing(col, &core.NumberField{Name: "cert_version", OnlyInt: true})
	addFieldIfMissing(col, &core.SelectField{Name: "status", MaxSelect: 1, Values: []string{"active", "expired", "revoked"}})
	addFieldIfMissing(col, &core.BoolField{Name: "auto_renew"})
	addFieldIfMissing(col, &core.TextField{Name: "description"})
	addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
	addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
	col.AddIndex("idx_certificates_name", true, "name", "")
	col.AddIndex("idx_certificates_domain", false, "domain", "")
	return app.Save(col)
}
