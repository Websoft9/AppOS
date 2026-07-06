package schema

import (
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

func addFieldIfMissing(col *core.Collection, field core.Field) {
	if col.Fields.GetByName(field.GetName()) == nil {
		col.Fields.Add(field)
	}
}

func addOrUpdateSelectField(col *core.Collection, field *core.SelectField) {
	if field == nil {
		return
	}
	existing := col.Fields.GetByName(field.Name)
	if existing == nil {
		col.Fields.Add(field)
		return
	}
	selectField, ok := existing.(*core.SelectField)
	if !ok {
		return
	}
	selectField.Required = field.Required
	selectField.MaxSelect = field.MaxSelect
	merged := append([]string(nil), selectField.Values...)
	for _, value := range field.Values {
		found := false
		for _, current := range merged {
			if current == value {
				found = true
				break
			}
		}
		if !found {
			merged = append(merged, value)
		}
	}
	selectField.Values = merged
}

func removeFieldIfExists(col *core.Collection, fieldName string) {
	if col.Fields.GetByName(fieldName) != nil {
		col.Fields.RemoveByName(fieldName)
	}
}

func authenticatedRule() *string {
	return types.Pointer("@request.auth.id != ''")
}

func lifecycleAuthRule() *string {
	return authenticatedRule()
}
