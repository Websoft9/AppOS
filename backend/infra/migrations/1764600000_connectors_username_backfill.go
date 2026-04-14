package migrations

import (
	"encoding/json"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
)

func init() {
	m.Register(func(app core.App) error {
		items, err := app.FindRecordsByFilter("connectors", "(kind = 'smtp' || kind = 'registry') && credential != ''", "", 0, 0, nil)
		if err != nil {
			return nil
		}

		for _, item := range items {
			config := decodeJSONMap(item.Get("config"))
			if strings.TrimSpace(stringValueFromMap(config, "username", "user")) != "" {
				continue
			}

			secretID := strings.TrimSpace(item.GetString("credential"))
			if secretID == "" {
				continue
			}
			secret, err := app.FindRecordById("secrets", secretID)
			if err != nil {
				continue
			}
			if strings.TrimSpace(secret.GetString("template_id")) != "basic_auth" {
				continue
			}

			meta := decodeJSONMap(secret.Get("payload_meta"))
			username := strings.TrimSpace(stringValueFromMap(meta, "username", "user"))
			if username == "" {
				continue
			}
			config["username"] = username
			item.Set("config", config)
			if err := app.Save(item); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		return nil
	})
}

func decodeJSONMap(raw any) map[string]any {
	if raw == nil {
		return map[string]any{}
	}
	if data, ok := raw.(map[string]any); ok {
		copy := make(map[string]any, len(data))
		for key, value := range data {
			copy[key] = value
		}
		return copy
	}
	b, err := json.Marshal(raw)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(b, &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}

func stringValueFromMap(group map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := group[key]; ok {
			if text, ok := value.(string); ok {
				return text
			}
		}
	}
	return ""
}
