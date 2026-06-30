package migrations

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	m "github.com/pocketbase/pocketbase/migrations"
	"github.com/websoft9/appos/backend/domain/assets"
)

func init() {
	m.Register(func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(assets.Collection)
		if err != nil {
			return err
		}

		kindField, ok := col.Fields.GetByName("kind").(*core.SelectField)
		if !ok {
			return fmt.Errorf("assets.kind field is missing or invalid")
		}
		kindField.Values = assets.SupportedKinds
		addFieldIfMissing(col, &core.BoolField{Name: "is_system"})
		addFieldIfMissing(col, &core.BoolField{Name: "is_template"})
		addFieldIfMissing(col, &core.SelectField{Name: "prompt_scope", Values: assets.SupportedPromptScopes})
		addFieldIfMissing(col, &core.TextField{Name: "template_key", Max: 128})
		if err := app.Save(col); err != nil {
			return err
		}

		for _, item := range assets.DefaultPromptDefinitions {
			if err := ensureSeededPromptAsset(app, col, item.Name, item.Description, item.TemplateKey, item.PromptScope, item.IsSystem, item.IsTemplate, item.Content); err != nil {
				return err
			}
		}

		return nil
	}, func(app core.App) error {
		col, err := app.FindCollectionByNameOrId(assets.Collection)
		if err != nil {
			return err
		}

		for _, definition := range assets.DefaultPromptDefinitions {
			templateKey := definition.TemplateKey
			record, findErr := app.FindFirstRecordByFilter(assets.Collection, "template_key = {:template_key}", map[string]any{"template_key": templateKey})
			if findErr == nil && record != nil {
				asset := assets.From(record)
				if removeErr := assets.RemoveLocalStorage(asset.StoragePath()); removeErr != nil {
					return removeErr
				}
				if deleteErr := app.Delete(record); deleteErr != nil {
					return deleteErr
				}
			}
		}

		if kindField, ok := col.Fields.GetByName("kind").(*core.SelectField); ok {
			kindField.Values = []string{assets.KindScript, assets.KindSkill}
		}
		col.Fields.RemoveByName("is_system")
		col.Fields.RemoveByName("is_template")
		col.Fields.RemoveByName("prompt_scope")
		col.Fields.RemoveByName("template_key")
		return app.Save(col)
	})
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
