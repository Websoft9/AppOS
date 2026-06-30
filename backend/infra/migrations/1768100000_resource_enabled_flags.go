package migrations

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/infra/collections"
)

func init() {
	m.Register(func(app core.App) error {
		for _, collectionName := range []string{
			collections.Instances,
			collections.Connectors,
			collections.ProviderAccounts,
			collections.AIProviders,
		} {
			col, err := app.FindCollectionByNameOrId(collectionName)
			if err != nil {
				return err
			}

			addFieldIfMissing(col, &core.BoolField{Name: "is_enabled"})
			if err := app.Save(col); err != nil {
				return err
			}

			records, err := app.FindAllRecords(collectionName)
			if err != nil {
				return err
			}
			for _, record := range records {
				record.Set("is_enabled", resourceEnabledValueForMigration(collectionName, record))
				if err := app.Save(record); err != nil {
					return err
				}
			}
		}

		return nil
	}, func(app core.App) error {
		return nil
	})
}

func resourceEnabledValueForMigration(collectionName string, record *core.Record) bool {
	if collectionName == collections.AIProviders {
		if value, ok := legacyConfigBool(record.Get("config"), "is_enabled"); ok {
			return value
		}
	}
	return true
}

func legacyConfigBool(raw any, key string) (bool, bool) {
	config, ok := raw.(map[string]any)
	if !ok {
		return false, false
	}
	value, exists := config[key]
	if !exists {
		return false, false
	}
	return boolValue(value)
}

func boolValue(raw any) (bool, bool) {
	switch value := raw.(type) {
	case bool:
		return value, true
	case string:
		normalized := strings.TrimSpace(strings.ToLower(value))
		if normalized == "" {
			return false, false
		}
		switch normalized {
		case "true", "1", "yes", "on":
			return true, true
		case "false", "0", "no", "off":
			return false, true
		default:
			return false, false
		}
	case int:
		return value != 0, true
	case int64:
		return value != 0, true
	case float64:
		return value != 0, true
	default:
		formatted := strings.TrimSpace(fmt.Sprint(value))
		if formatted == "" || formatted == "<nil>" {
			return false, false
		}
		return false, false
	}
}
