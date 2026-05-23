package migrations

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return err
		}

		addFieldIfMissing(col, &core.AutodateField{Name: "created", OnCreate: true})
		addFieldIfMissing(col, &core.AutodateField{Name: "updated", OnCreate: true, OnUpdate: true})
		if err := app.Save(col); err != nil {
			return err
		}

		records, err := app.FindAllRecords("servers")
		if err != nil {
			return err
		}

		now := time.Now().UTC()
		for _, record := range records {
			needsSave := false
			if record.GetDateTime("created").IsZero() {
				record.Set("created", now)
				needsSave = true
			}
			if record.GetDateTime("updated").IsZero() {
				record.Set("updated", now)
				needsSave = true
			}
			if needsSave {
				if err := app.Save(record); err != nil {
					return err
				}
			}
		}

		return nil
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("servers")
		if err != nil {
			return nil
		}
		col.Fields.RemoveByName("created")
		col.Fields.RemoveByName("updated")
		return app.Save(col)
	})
}