package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/pocketbase/pocketbase/tools/types"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_sources")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("failure_streak") == nil {
			col.Fields.Add(&core.NumberField{Name: "failure_streak", OnlyInt: true, Min: types.Pointer(0.0), Max: types.Pointer(2147483647.0)})
		}
		if col.Fields.GetByName("next_poll_at") == nil {
			col.Fields.Add(&core.DateField{Name: "next_poll_at"})
		}
		col.Fields.RemoveByName("poll_interval_minutes")

		if err := app.Save(col); err != nil {
			return err
		}

		_, err = app.DB().NewQuery(`
			UPDATE feed_sources
			SET failure_streak = COALESCE(failure_streak, 0),
				next_poll_at = CASE
					WHEN status = 'active' AND (next_poll_at IS NULL OR next_poll_at = '') THEN COALESCE(last_fetched_at, created)
					ELSE next_poll_at
				END
		`).Execute()
		return err
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId("feed_sources")
		if err != nil {
			return err
		}

		if col.Fields.GetByName("poll_interval_minutes") == nil {
			col.Fields.Add(&core.NumberField{Name: "poll_interval_minutes", Required: true, OnlyInt: true, Min: types.Pointer(1.0)})
		}
		col.Fields.RemoveByName("failure_streak")
		col.Fields.RemoveByName("next_poll_at")

		if err := app.Save(col); err != nil {
			return err
		}

		_, err = app.DB().NewQuery("UPDATE feed_sources SET poll_interval_minutes = 60").Execute()
		if err != nil {
			return fmt.Errorf("restore feed_sources poll interval: %w", err)
		}
		return nil
	})
}