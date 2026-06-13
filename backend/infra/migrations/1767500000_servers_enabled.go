package migrations

import (
	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}

		addFieldIfMissing(col, &core.BoolField{Name: "is_enabled"})
		if err := app.Save(col); err != nil {
			return err
		}

		records, err := app.FindAllRecords("servers")
		if err != nil {
			return err
		}
		for _, record := range records {
			record.Set("is_enabled", true)
			if err := app.Save(record); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		return nil
	})
}
