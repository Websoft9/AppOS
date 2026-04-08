package tunnelcore

import (
	"testing"
)

func TestDefaultPortRange(t *testing.T) {
	portRange := DefaultPortRange()
	if portRange.Start != DefaultPortRangeStart {
		t.Fatalf("expected default start %d, got %d", DefaultPortRangeStart, portRange.Start)
	}
	if portRange.End != DefaultPortRangeEnd {
		t.Fatalf("expected default end %d, got %d", DefaultPortRangeEnd, portRange.End)
	}
}

func TestNormalizePortRangeRejectsInvalidRange(t *testing.T) {
	portRange := NormalizePortRange(map[string]any{
		"start": 2200,
		"end":   2300,
	})

	if portRange != DefaultPortRange() {
		t.Fatalf("expected invalid range to fall back to defaults, got %#v", portRange)
	}
}
