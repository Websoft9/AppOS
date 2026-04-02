package sharedenv

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Set is the normalized read model for one shared env set.
type Set struct {
	ID          string
	Name        string
	Description string
}

func findSetRecord(app core.App, setID string) (*core.Record, error) {
	if app == nil {
		return nil, fmt.Errorf("shared env lookup requires app context")
	}
	if strings.TrimSpace(setID) == "" {
		return nil, fmt.Errorf("shared env lookup requires set_id")
	}
	record, err := app.FindRecordById(SetCollection, strings.TrimSpace(setID))
	if err != nil {
		return nil, fmt.Errorf("shared env set not found")
	}
	return record, nil
}

// GetSet resolves one env set into a normalized read model.
func GetSet(app core.App, setID string) (*Set, error) {
	record, err := findSetRecord(app, setID)
	if err != nil {
		return nil, err
	}
	return SetFromRecord(record), nil
}

// SetFromRecord normalizes an env_sets record.
func SetFromRecord(record *core.Record) *Set {
	if record == nil {
		return nil
	}
	return &Set{
		ID:          record.Id,
		Name:        strings.TrimSpace(record.GetString("name")),
		Description: strings.TrimSpace(record.GetString("description")),
	}
}

// AttachedSetIDs returns the ordered, unique env set attachment ids stored on a
// consumer record.
func AttachedSetIDs(record *core.Record) []string {
	if record == nil {
		return nil
	}
	return normalizeIDList(record.Get(AttachedSetsField))
}

func normalizeIDList(value any) []string {
	switch raw := value.(type) {
	case []string:
		return compactStrings(raw)
	case []any:
		result := make([]string, 0, len(raw))
		for _, item := range raw {
			s, ok := item.(string)
			if !ok {
				continue
			}
			result = append(result, s)
		}
		return compactStrings(result)
	case string:
		if strings.TrimSpace(raw) == "" {
			return nil
		}
		return []string{strings.TrimSpace(raw)}
	default:
		return nil
	}
}

func compactStrings(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}
