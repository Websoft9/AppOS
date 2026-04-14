package migrations

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		certificatesCol, err := app.FindCollectionByNameOrId("certificates")
		if err != nil {
			return err
		}
		secretsCol, err := app.FindCollectionByNameOrId("secrets")
		if err != nil {
			return err
		}

		if certificatesCol.Fields.GetByName("private_key_secret") == nil {
			certificatesCol.Fields.Add(&core.RelationField{Name: "private_key_secret", CollectionId: secretsCol.Id, MaxSelect: 1})
		}
		if err := app.Save(certificatesCol); err != nil {
			return err
		}

		records, err := app.FindRecordsByFilter("certificates", "", "", 0, 0, nil)
		if err != nil {
			return err
		}
		for _, record := range records {
			legacyID := strings.TrimSpace(record.GetString("key"))
			if strings.TrimSpace(record.GetString("private_key_secret")) != "" || legacyID == "" {
				continue
			}
			record.Set("private_key_secret", legacyID)
			if err := app.Save(record); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		certificatesCol, err := app.FindCollectionByNameOrId("certificates")
		if err != nil {
			return nil
		}
		certificatesCol.Fields.RemoveByName("private_key_secret")
		return app.Save(certificatesCol)
	})
}
