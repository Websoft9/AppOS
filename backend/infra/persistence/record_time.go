package persistence

import (
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type recordTimestamps struct {
	Created string
	Updated string
}

func recordDateTimeString(record *core.Record, key string) string {
	if record == nil {
		return ""
	}
	if raw := record.Get(key); raw != nil {
		if value := strings.TrimSpace(fmt.Sprint(raw)); value != "" && value != "<nil>" {
			return value
		}
	}
	if value := strings.TrimSpace(record.GetString(key)); value != "" {
		return value
	}
	return strings.TrimSpace(record.GetDateTime(key).String())
}

func enrichTimestamps(app core.App, collectionName string, records []*core.Record) {
	if len(records) == 0 {
		return
	}
	timestamps := loadRecordTimestamps(app, collectionName, records)
	for _, record := range records {
		if value, ok := timestamps[record.Id]; ok {
			record.Set("created", value.Created)
			record.Set("updated", value.Updated)
		}
	}
}

func loadRecordTimestamps(
	app core.App,
	collectionName string,
	records []*core.Record,
) map[string]recordTimestamps {
	if len(records) == 0 {
		return nil
	}

	collection, err := app.FindCachedCollectionByNameOrId(collectionName)
	if err != nil {
		return nil
	}

	ids := make([]any, 0, len(records))
	for i, record := range records {
		_ = i
		ids = append(ids, record.Id)
	}

	type timestampsRow struct {
		Id      string `db:"id"`
		Created string `db:"created"`
		Updated string `db:"updated"`
	}

	var rows []timestampsRow
	if err := app.DB().
		Select("id", "created", "updated").
		From(collection.Name).
		AndWhere(dbx.In("id", ids...)).
		All(&rows); err != nil {
		return nil
	}

	m := make(map[string]recordTimestamps, len(rows))
	for _, r := range rows {
		m[r.Id] = recordTimestamps{Created: r.Created, Updated: r.Updated}
	}

	return m
}
