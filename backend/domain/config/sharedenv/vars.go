package sharedenv

import (
	"fmt"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Var is the normalized read model for one env_set_vars record.
type Var struct {
	ID       string
	SetID    string
	Key      string
	Value    string
	IsSecret bool
	SecretID string
}

func listVarRecords(app core.App, setID string) ([]*core.Record, error) {
	if app == nil {
		return nil, fmt.Errorf("shared env lookup requires app context")
	}
	if strings.TrimSpace(setID) == "" {
		return nil, fmt.Errorf("shared env lookup requires set_id")
	}
	records, err := app.FindAllRecords(VarCollection, dbx.HashExp{
		SetRelationField: strings.TrimSpace(setID),
	})
	if err != nil {
		return nil, fmt.Errorf("shared env variables not found for set %q", setID)
	}
	return records, nil
}

// ListVars returns normalized vars for one set.
func ListVars(app core.App, setID string) ([]Var, error) {
	records, err := listVarRecords(app, setID)
	if err != nil {
		return nil, err
	}
	result := make([]Var, 0, len(records))
	for _, record := range records {
		result = append(result, VarFromRecord(record))
	}
	return result, nil
}

// VarFromRecord normalizes one env_set_vars record.
func VarFromRecord(record *core.Record) Var {
	if record == nil {
		return Var{}
	}
	return Var{
		ID:       record.Id,
		SetID:    strings.TrimSpace(record.GetString(SetRelationField)),
		Key:      strings.TrimSpace(record.GetString("key")),
		Value:    record.GetString("value"),
		IsSecret: record.GetBool("is_secret"),
		SecretID: strings.TrimSpace(record.GetString(SecretRelationField)),
	}
}
