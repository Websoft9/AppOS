package catalog

import (
	"testing"
)

func TestFindEntry_Known(t *testing.T) {
	entry, ok := FindEntry("smtp")
	if !ok {
		t.Fatal("expected to find smtp entry")
	}
	if entry.ID != "smtp" {
		t.Fatalf("expected id smtp, got %s", entry.ID)
	}
	if entry.Source != SourceNative {
		t.Fatalf("expected source native, got %s", entry.Source)
	}
	if entry.PocketBaseGroup != "smtp" {
		t.Fatalf("expected PocketBaseGroup smtp, got %s", entry.PocketBaseGroup)
	}
}

func TestFindEntry_NotFound(t *testing.T) {
	_, ok := FindEntry("nonexistent-entry")
	if ok {
		t.Fatal("expected not found for nonexistent entry")
	}
}

func TestFindEntry_ReturnsDeepCopy(t *testing.T) {
	e1, _ := FindEntry("smtp")
	e2, _ := FindEntry("smtp")
	if len(e1.Fields) == 0 {
		t.Fatal("expected smtp to have fields")
	}
	e1.Fields[0].Label = "MUTATED"
	if e2.Fields[0].Label == "MUTATED" {
		t.Fatal("FindEntry must return a deep copy; mutation leaked to catalog")
	}
}

func TestDefaultGroup_KnownKey(t *testing.T) {
	g := DefaultGroup("space", "quota")
	if g == nil {
		t.Fatal("expected non-nil default group for space/quota")
	}
	if _, ok := g["maxSizeMB"]; !ok {
		t.Fatal("expected maxSizeMB in space/quota defaults")
	}
}

func TestDefaultGroup_UnknownKey(t *testing.T) {
	g := DefaultGroup("unknown", "key")
	if g == nil {
		t.Fatal("expected non-nil map for unknown key")
	}
	if len(g) != 0 {
		t.Fatalf("expected empty map for unknown key, got %v", g)
	}
}

func TestDefaultGroup_ReturnsDeepCopy(t *testing.T) {
	g1 := DefaultGroup("space", "quota")
	g2 := DefaultGroup("space", "quota")
	g1["maxSizeMB"] = 99999
	if g2["maxSizeMB"] == 99999 {
		t.Fatal("DefaultGroup must return a deep copy; mutation leaked")
	}
}

func TestSeedRows_CountMatchesCustomEntries(t *testing.T) {
	rows := SeedRows()
	customCount := 0
	for _, e := range entryCatalog {
		if e.Source == SourceCustom {
			customCount++
		}
	}
	if len(rows) != customCount {
		t.Fatalf("expected %d seed rows for custom entries, got %d", customCount, len(rows))
	}
}

func TestSeedRows_AllHaveNonNilValues(t *testing.T) {
	for _, row := range SeedRows() {
		if row.Value == nil {
			t.Fatalf("seed row %s/%s has nil value", row.Module, row.Key)
		}
	}
}

func TestEntries_ReturnsAllCatalogEntries(t *testing.T) {
	entries := Entries()
	if len(entries) != len(entryCatalog) {
		t.Fatalf("expected %d entries, got %d", len(entryCatalog), len(entries))
	}
}

func TestEntries_PreservesCatalogOrder(t *testing.T) {
	entries := Entries()
	for i, e := range entries {
		if e.ID != entryCatalog[i].ID {
			t.Fatalf("entry order mismatch at index %d: expected %s, got %s", i, entryCatalog[i].ID, e.ID)
		}
	}
}

func TestEntries_ReturnsDeepCopy(t *testing.T) {
	e1 := Entries()
	e2 := Entries()
	if len(e1) == 0 {
		t.Fatal("expected non-empty entries")
	}
	e1[0].Title = "MUTATED"
	if e2[0].Title == "MUTATED" {
		t.Fatal("Entries must return a deep copy; mutation leaked")
	}
}

func TestActions_ReturnsAllActions(t *testing.T) {
	actions := Actions()
	if len(actions) != len(actionCatalog) {
		t.Fatalf("expected %d actions, got %d", len(actionCatalog), len(actions))
	}
}

func TestActions_ReturnsDeepCopy(t *testing.T) {
	a1 := Actions()
	a2 := Actions()
	if len(a1) == 0 {
		t.Fatal("expected non-empty actions")
	}
	a1[0].Title = "MUTATED"
	if a2[0].Title == "MUTATED" {
		t.Fatal("Actions must return a deep copy; mutation leaked")
	}
}

func TestEveryCustomEntry_HasDefaultGroup(t *testing.T) {
	for _, e := range entryCatalog {
		if e.Source != SourceCustom {
			continue
		}
		g := DefaultGroup(e.Module, e.Key)
		if len(g) == 0 {
			t.Errorf("custom entry %s (module=%s, key=%s) has no default group defined", e.ID, e.Module, e.Key)
		}
	}
}

func TestEveryNativeEntry_HasPocketBaseGroup(t *testing.T) {
	for _, e := range entryCatalog {
		if e.Source != SourceNative {
			continue
		}
		if e.PocketBaseGroup == "" {
			t.Errorf("native entry %s has no PocketBaseGroup", e.ID)
		}
	}
}

func TestEveryCustomEntry_HasModuleAndKey(t *testing.T) {
	for _, e := range entryCatalog {
		if e.Source != SourceCustom {
			continue
		}
		if e.Module == "" {
			t.Errorf("custom entry %s has no Module", e.ID)
		}
		if e.Key == "" {
			t.Errorf("custom entry %s has no Key", e.ID)
		}
	}
}
