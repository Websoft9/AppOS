package schema

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/monitor"
	"github.com/websoft9/appos/backend/infra/collections"
)

func TestAddOrUpdateSelectFieldMergesValues(t *testing.T) {
	col := core.NewBaseCollection(collections.MonitorLatestStatus)
	col.Fields.Add(&core.SelectField{
		Name:      "target_type",
		Required:  true,
		MaxSelect: 1,
		Values:    []string{monitor.TargetTypeServer, monitor.TargetTypeResource},
	})

	addOrUpdateSelectField(col, &core.SelectField{
		Name:      "target_type",
		Required:  true,
		MaxSelect: 1,
		Values:    []string{monitor.TargetTypeServer, monitor.TargetTypeResource, monitor.TargetTypeConnector},
	})

	field, ok := col.Fields.GetByName("target_type").(*core.SelectField)
	if !ok {
		t.Fatal("expected target_type select field")
	}
	if len(field.Values) != 3 {
		t.Fatalf("expected merged select values, got %+v", field.Values)
	}
	if field.Values[2] != monitor.TargetTypeConnector {
		t.Fatalf("expected connector value to be added, got %+v", field.Values)
	}
}