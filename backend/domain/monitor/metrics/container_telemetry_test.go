package metrics

import "testing"

func TestContainerTelemetryTargetNamesPreferNames(t *testing.T) {
	values := containerTelemetryTargetNames([]ContainerTelemetryTarget{{ID: "ctr-1", Name: "demo-web"}, {ID: "ctr-2", Name: "/demo-worker"}})
	if len(values) != 2 {
		t.Fatalf("expected two selector values, got %+v", values)
	}
	expected := []string{"demo-web", "demo-worker"}
	for index, value := range expected {
		if values[index] != value {
			t.Fatalf("expected selector[%d]=%q, got %+v", index, value, values)
		}
	}
}

func TestContainerTelemetryTargetAliasesUseNameOnlyWhenPresent(t *testing.T) {
	aliases := containerTelemetryTargetAliases(ContainerTelemetryTarget{ID: "ctr-1", Name: "/demo-web,demo-web"})
	if len(aliases) != 1 {
		t.Fatalf("expected normalized name alias only, got %+v", aliases)
	}
	if aliases[0] != "demo-web" {
		t.Fatalf("unexpected aliases %+v", aliases)
	}
}
