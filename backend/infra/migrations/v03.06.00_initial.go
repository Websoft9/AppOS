package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/assets"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
	appschema "github.com/websoft9/appos/backend/infra/schema"
)

func init() {
	m.Register(func(app core.App) error {
		if err := appschema.EnsureAllCollections(app); err != nil {
			return err
		}

		if err := ensureDefaultGroupSeed(app); err != nil {
			return err
		}

		if err := ensureCustomSettingsSeed(app); err != nil {
			return err
		}

		return ensurePromptAssetsSeed(app)
	}, nil)
}

func ensureDefaultGroupSeed(app core.App) error {
	groupsCol, err := app.FindCollectionByNameOrId("groups")
	if err != nil {
		return err
	}

	defaultGroup, err := app.FindFirstRecordByFilter("groups", "name = 'default'")
	if err == nil && defaultGroup != nil {
		return nil
	}

	record := core.NewRecord(groupsCol)
	record.Set("name", "default")
	record.Set("description", "Default group")
	record.Set("is_default", true)
	return app.Save(record)
}

func ensureCustomSettingsSeed(app core.App) error {
	if _, err := app.FindCollectionByNameOrId("custom_settings"); err != nil {
		return err
	}

	for _, row := range settingsschema.SeedRows() {
		if err := sysconfig.SetGroup(app, row.Module, row.Key, row.Value); err != nil {
			return err
		}
	}

	return nil
}

func ensurePromptAssetsSeed(app core.App) error {
	col, err := app.FindCollectionByNameOrId(assets.Collection)
	if err != nil {
		return err
	}
	if col.Fields.GetByName("template_key") == nil {
		return fmt.Errorf("assets schema is not initialized before prompt seed")
	}

	for _, item := range assets.DefaultPromptDefinitions {
		if err := ensureSeededPromptAsset(app, col, item.Name, item.Description, item.TemplateKey, item.PromptScope, item.IsSystem, item.IsTemplate, item.Content); err != nil {
			return err
		}
	}

	return nil
}

func ensureSeededPromptAsset(app core.App, col *core.Collection, name, description, templateKey, promptScope string, isSystem, isTemplate bool, content string) error {
	record, err := app.FindFirstRecordByFilter(assets.Collection, "template_key = {:template_key}", map[string]any{"template_key": templateKey})
	if err == nil && record != nil {
		record.Set("prompt_scope", assets.NormalizePromptScope(promptScope))
		record.Set("is_system", isSystem)
		record.Set("is_template", isTemplate)
		if saveErr := app.Save(record); saveErr != nil {
			return saveErr
		}
		asset := assets.From(record)
		if err := assets.WriteLocalFile(asset.StoragePath(), asset.Path(), content); err != nil {
			return err
		}
		return nil
	}

	record = core.NewRecord(col)
	record.Set("name", name)
	record.Set("description", description)
	record.Set("kind", assets.KindPrompt)
	record.Set("storage_kind", assets.StorageFile)
	record.Set("source_kind", assets.SourceLocal)
	record.Set("language", "")
	record.Set("script_extension", "")
	record.Set("reference", "")
	record.Set("entrypoint", "")
	record.Set("template_key", templateKey)
	record.Set("prompt_scope", assets.NormalizePromptScope(promptScope))
	record.Set("is_system", isSystem)
	record.Set("is_template", isTemplate)
	if err := app.Save(record); err != nil {
		return err
	}
	path := assets.PromptFileName(name, record.Id)
	record.Set("path", path)
	if err := app.Save(record); err != nil {
		return err
	}
	return assets.WriteLocalFile(assets.StoragePath(name, record.Id), path, content)
}
