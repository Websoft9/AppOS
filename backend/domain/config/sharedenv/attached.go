package sharedenv

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// AttachedVar preserves both the attached set identity and the normalized var.
// The returned order follows the consumer's env_sets attachment order.
type AttachedVar struct {
	SetID   string
	SetName string
	Var     Var
}

// LoadAttachedVars expands the env set attachments from a consumer record into
// a flat variable list. Later attached sets appear later in the slice, so
// lifecycle consumers can apply "later set wins" semantics by iterating in order.
func LoadAttachedVars(app core.App, consumer *core.Record) ([]AttachedVar, error) {
	setIDs := AttachedSetIDs(consumer)
	if len(setIDs) == 0 {
		return nil, nil
	}

	result := make([]AttachedVar, 0)
	for _, setID := range setIDs {
		set, err := GetSet(app, setID)
		if err != nil {
			return nil, fmt.Errorf("load attached env set %q: %w", setID, err)
		}
		vars, err := ListVars(app, setID)
		if err != nil {
			return nil, fmt.Errorf("load attached env vars for set %q: %w", setID, err)
		}
		for _, item := range vars {
			result = append(result, AttachedVar{
				SetID:   set.ID,
				SetName: set.Name,
				Var:     item,
			})
		}
	}

	if len(result) == 0 {
		return nil, nil
	}
	return result, nil
}
