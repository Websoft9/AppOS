package groups

import (
	"fmt"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// ─── Object types ─────────────────────────────────────────────────────────────

// ObjectType identifies the domain type of a group member.
// Values must match the object_type strings stored in the group_items collection.
type ObjectType string

const (
	ObjectTypeServer       ObjectType = "server"
	ObjectTypeSecret       ObjectType = "secret"
	ObjectTypeEnvGroup     ObjectType = "env_group"
	ObjectTypeDatabase     ObjectType = "database"
	ObjectTypeCloudAccount ObjectType = "cloud_account"
	ObjectTypeCertificate  ObjectType = "certificate"
	ObjectTypeEndpoint     ObjectType = "endpoint"
	ObjectTypeScript       ObjectType = "script"
)

// ─── Group membership queries ─────────────────────────────────────────────────

// LoadNamesForObjects returns a map of objectID → sorted group names
// for the given objectType and objectIDs.
//
// Only the provided objectIDs are considered; the returned map contains an
// entry for every objectID that belongs to at least one group. IDs with no
// group membership are absent from the result.
func LoadNamesForObjects(app core.App, objectType ObjectType, objectIDs []string) (map[string][]string, error) {
	result := map[string][]string{}
	if len(objectIDs) == 0 {
		return result, nil
	}

	// Build a targeted filter to avoid a full table scan.
	// "object_type = {:type} && (object_id = {:id0} || object_id = {:id1} || ...)"
	idClauses := make([]string, 0, len(objectIDs))
	params := map[string]any{"type": string(objectType)}
	for i, id := range objectIDs {
		key := fmt.Sprintf("oid%d", i)
		idClauses = append(idClauses, fmt.Sprintf("object_id = {:%s}", key))
		params[key] = id
	}
	filter := fmt.Sprintf("object_type = {:type} && (%s)", strings.Join(idClauses, " || "))

	items, err := app.FindRecordsByFilter(ItemsCollection, filter, "", 0, 0, params)
	if err != nil {
		return result, err
	}

	// membership: objectID → []groupID
	membership := map[string][]string{}
	groupSet := map[string]struct{}{}
	for _, item := range items {
		objectID := item.GetString("object_id")
		groupID := item.GetString("group_id")
		if groupID == "" {
			continue
		}
		membership[objectID] = append(membership[objectID], groupID)
		groupSet[groupID] = struct{}{}
	}
	if len(groupSet) == 0 {
		return result, nil
	}

	groups, err := app.FindAllRecords(Collection)
	if err != nil {
		return result, err
	}
	nameMap := map[string]string{}
	for _, g := range groups {
		if _, ok := groupSet[g.Id]; ok {
			nameMap[g.Id] = g.GetString("name")
		}
	}

	for objectID, groupIDs := range membership {
		names := make([]string, 0, len(groupIDs))
		for _, groupID := range groupIDs {
			if name := nameMap[groupID]; name != "" {
				names = append(names, name)
			}
		}
		sort.Strings(names)
		result[objectID] = names
	}

	return result, nil
}
