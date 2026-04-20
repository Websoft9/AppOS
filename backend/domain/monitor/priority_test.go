package monitor

import "testing"

func TestStatusPriorityWithMapDefaults(t *testing.T) {
	cases := []struct {
		status   string
		expected int
	}{
		{"credential_invalid", 5},
		{"CREDENTIAL_INVALID", 5},
		{"unreachable", 4},
		{"degraded", 3},
		{"offline", 2},
		{"unknown", 1},
		{"healthy", 0},
		{"", 0},
		{"totally_unknown_status", 0},
	}
	for _, tc := range cases {
		got := StatusPriorityWithMap(tc.status, nil)
		if got != tc.expected {
			t.Errorf("StatusPriorityWithMap(%q, nil) = %d, want %d", tc.status, got, tc.expected)
		}
	}
}

func TestStatusPriorityWithMapCustomOverride(t *testing.T) {
	customMap := map[string]int{
		"offline": 10,
		"healthy": 5,
	}
	if got := StatusPriorityWithMap("offline", customMap); got != 10 {
		t.Errorf("expected custom priority 10 for offline, got %d", got)
	}
	if got := StatusPriorityWithMap("healthy", customMap); got != 5 {
		t.Errorf("expected custom priority 5 for healthy, got %d", got)
	}
	// fallback to default when key absent from custom map
	if got := StatusPriorityWithMap("degraded", customMap); got != 3 {
		t.Errorf("expected default priority 3 for degraded, got %d", got)
	}
}

func TestIsStrongerFailure(t *testing.T) {
	cases := []struct {
		existing string
		next     string
		expected bool
	}{
		// existing more severe than next → true
		{"offline", "unknown", true},
		{"unreachable", "degraded", true},
		{"credential_invalid", "offline", true},
		// existing equal to next → false
		{"offline", "offline", false},
		{"unknown", "unknown", false},
		// next more severe → false
		{"unknown", "offline", false},
		{"degraded", "unreachable", false},
		{"healthy", "offline", false},
	}
	for _, tc := range cases {
		got := IsStrongerFailure(tc.existing, tc.next, nil)
		if got != tc.expected {
			t.Errorf("IsStrongerFailure(%q, %q, nil) = %v, want %v", tc.existing, tc.next, got, tc.expected)
		}
	}
}

func TestIsStrongerFailureWithCustomPriorityMap(t *testing.T) {
	customMap := map[string]int{"unknown": 99, "offline": 1}
	if !IsStrongerFailure("unknown", "offline", customMap) {
		t.Error("expected unknown (99) to be stronger than offline (1) with custom map")
	}
	if IsStrongerFailure("offline", "unknown", customMap) {
		t.Error("expected offline (1) NOT to be stronger than unknown (99) with custom map")
	}
}
