package sharedenv

import (
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// VarLookup identifies one shared env variable inside a specific env set.
// Callers may provide VarID, SourceKey, or both.
// When both are provided they must resolve to the same variable.
type VarLookup struct {
	SetID     string
	VarID     string
	SourceKey string
}

// FindVar resolves one shared env variable under the expected env set.
func FindVar(app core.App, lookup VarLookup) (Var, error) {
	record, err := findVarRecord(app, lookup)
	if err != nil {
		return Var{}, err
	}
	return VarFromRecord(record), nil
}

func findVarRecord(app core.App, lookup VarLookup) (*core.Record, error) {
	if app == nil {
		return nil, fmt.Errorf("shared env lookup requires app context")
	}
	setID := strings.TrimSpace(lookup.SetID)
	varID := strings.TrimSpace(lookup.VarID)
	sourceKey := strings.TrimSpace(lookup.SourceKey)

	if setID == "" {
		return nil, fmt.Errorf("shared env lookup requires set_id")
	}
	if varID == "" && sourceKey == "" {
		return nil, fmt.Errorf("shared env lookup requires var_id or source_key")
	}
	if varID != "" {
		record, err := app.FindRecordById(VarCollection, varID)
		if err != nil {
			return nil, fmt.Errorf("shared env variable not found")
		}
		if strings.TrimSpace(record.GetString(SetRelationField)) != setID {
			return nil, fmt.Errorf("shared env variable does not belong to set %q", setID)
		}
		if sourceKey != "" && strings.TrimSpace(record.GetString("key")) != sourceKey {
			return nil, fmt.Errorf("shared env lookup criteria do not refer to the same variable")
		}
		return record, nil
	}

	record, err := app.FindFirstRecordByFilter(
		VarCollection,
		"set = {:set} && key = {:key}",
		dbx.Params{"set": setID, "key": sourceKey},
	)
	if err != nil {
		return nil, fmt.Errorf("shared env variable %q not found in set %q", sourceKey, setID)
	}
	return record, nil
}
