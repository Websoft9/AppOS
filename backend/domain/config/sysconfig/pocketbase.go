package sysconfig

import (
	"encoding/json"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	settingscatalog "github.com/websoft9/appos/backend/domain/config/sysconfig/catalog"
)

func LoadPocketBaseEntry(app core.App, entry settingscatalog.EntrySchema) (map[string]any, error) {
	clone, err := app.Settings().Clone()
	if err != nil {
		return nil, err
	}
	return exportPocketBaseEntry(clone, entry)
}

func PatchPocketBaseEntry(app core.App, entry settingscatalog.EntrySchema, value map[string]any) (map[string]any, error) {
	clone, err := app.Settings().Clone()
	if err != nil {
		return nil, err
	}

	wrapper, err := pocketBasePatchWrapper(entry, value)
	if err != nil {
		return nil, err
	}

	raw, err := json.Marshal(wrapper)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, clone); err != nil {
		return nil, err
	}
	if err := app.Save(clone); err != nil {
		return nil, err
	}

	stored, err := app.Settings().Clone()
	if err != nil {
		return nil, err
	}
	return exportPocketBaseEntry(stored, entry)
}

func pocketBasePatchWrapper(entry settingscatalog.EntrySchema, value map[string]any) (map[string]any, error) {
	if entry.PocketBaseGroup == "" {
		return nil, fmt.Errorf("settings entry %s has no pocketbase group", entry.ID)
	}
	return map[string]any{entry.PocketBaseGroup: value}, nil
}

func exportPocketBaseEntry(current *core.Settings, entry settingscatalog.EntrySchema) (map[string]any, error) {
	if entry.PocketBaseGroup == "" {
		return nil, fmt.Errorf("settings entry %s has no pocketbase group", entry.ID)
	}

	raw, err := json.Marshal(current)
	if err != nil {
		return nil, err
	}

	var exported map[string]any
	if err := json.Unmarshal(raw, &exported); err != nil {
		return nil, err
	}

	group, _ := exported[entry.PocketBaseGroup].(map[string]any)
	if group == nil {
		return map[string]any{}, nil
	}

	// Project only fields declared in the catalog entry schema.
	result := make(map[string]any, len(entry.Fields))
	for _, f := range entry.Fields {
		if v, ok := group[f.ID]; ok {
			result[f.ID] = v
		}
	}
	return result, nil
}
