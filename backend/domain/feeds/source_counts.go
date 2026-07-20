package feeds

import (
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type sourceItemCountRow struct {
	Count int `db:"count"`
}

func CountSourceItems(app core.App, sourceID string) (int, error) {
	trimmedSourceID := strings.TrimSpace(sourceID)
	if trimmedSourceID == "" {
		return 0, nil
	}

	var row sourceItemCountRow
	if err := app.DB().NewQuery(`
		SELECT COUNT(*) AS count
		FROM feed_items
		WHERE origin_type = {:origin_type} AND source_id = {:source_id}`,
	).Bind(dbx.Params{"origin_type": OriginTypeFeed, "source_id": trimmedSourceID}).One(&row); err != nil {
		return 0, err
	}

	return row.Count, nil
}

func SetSourceItemCount(app core.App, sourceRecord *core.Record) error {
	if sourceRecord == nil {
		return nil
	}

	count, err := CountSourceItems(app, sourceRecord.Id)
	if err != nil {
		return err
	}

	sourceRecord.Set("item_count", count)
	return nil
}

func RefreshSourceItemCount(app core.App, sourceID string) error {
	trimmedSourceID := strings.TrimSpace(sourceID)
	if trimmedSourceID == "" {
		return nil
	}

	sourceRecord, err := app.FindRecordById(CollectionSources, trimmedSourceID)
	if err != nil {
		return err
	}

	if err := SetSourceItemCount(app, sourceRecord); err != nil {
		return err
	}

	return app.Save(sourceRecord)
}
