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
