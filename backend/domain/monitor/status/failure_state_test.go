package status

import (
	"testing"
	"time"
)

var testNow = time.Date(2026, 4, 19, 10, 0, 0, 0, time.UTC)

func TestFailureStateFromPreviousHealthyResetsCount(t *testing.T) {
	failures, successAt, failureAt := FailureStateFromPrevious(5, "healthy", "healthy", testNow)
	if failures != 0 {
		t.Errorf("expected failures=0, got %d", failures)
	}
	if successAt == nil || !successAt.Equal(testNow) {
		t.Errorf("expected lastSuccessAt=%v, got %v", testNow, successAt)
	}
	if failureAt != nil {
		t.Errorf("expected lastFailureAt=nil, got %v", failureAt)
	}
}

func TestFailureStateFromPreviousNonHealthyIncrementsCount(t *testing.T) {
	failures, successAt, failureAt := FailureStateFromPrevious(3, "offline", "healthy", testNow)
	if failures != 4 {
		t.Errorf("expected failures=4, got %d", failures)
	}
	if successAt != nil {
		t.Errorf("expected lastSuccessAt=nil, got %v", successAt)
	}
	if failureAt == nil || !failureAt.Equal(testNow) {
		t.Errorf("expected lastFailureAt=%v, got %v", testNow, failureAt)
	}
}

func TestFailureStateFromPreviousZeroBaselineIncrementsToOne(t *testing.T) {
	failures, _, failureAt := FailureStateFromPrevious(0, "degraded", "healthy", testNow)
	if failures != 1 {
		t.Errorf("expected failures=1, got %d", failures)
	}
	if failureAt == nil {
		t.Error("expected lastFailureAt to be set")
	}
}

func TestFailureStateFromPreviousCaseInsensitive(t *testing.T) {
	failures, successAt, _ := FailureStateFromPrevious(2, "HEALTHY", "healthy", testNow)
	if failures != 0 {
		t.Errorf("expected case-insensitive healthy to reset failures, got %d", failures)
	}
	if successAt == nil {
		t.Error("expected lastSuccessAt to be set for case-insensitive healthy")
	}
}

func TestSingleObservationFailureStateHealthy(t *testing.T) {
	failures, successAt, failureAt := SingleObservationFailureState("healthy", "healthy", testNow)
	if failures != 0 {
		t.Errorf("expected failures=0, got %d", failures)
	}
	if successAt == nil || !successAt.Equal(testNow) {
		t.Errorf("expected lastSuccessAt=%v, got %v", testNow, successAt)
	}
	if failureAt != nil {
		t.Errorf("expected lastFailureAt=nil, got %v", failureAt)
	}
}

func TestSingleObservationFailureStateNonHealthy(t *testing.T) {
	failures, successAt, failureAt := SingleObservationFailureState("unreachable", "healthy", testNow)
	if failures != 1 {
		t.Errorf("expected failures=1, got %d", failures)
	}
	if successAt != nil {
		t.Errorf("expected lastSuccessAt=nil, got %v", successAt)
	}
	if failureAt == nil || !failureAt.Equal(testNow) {
		t.Errorf("expected lastFailureAt=%v, got %v", testNow, failureAt)
	}
}

func TestSingleObservationFailureStateIgnoresPreviousHistory(t *testing.T) {
	// Unlike FailureStateFromPrevious, this always starts at 1 for non-healthy
	f1, _, _ := SingleObservationFailureState("offline", "healthy", testNow)
	f2, _, _ := SingleObservationFailureState("offline", "healthy", testNow)
	if f1 != 1 || f2 != 1 {
		t.Errorf("expected SingleObservationFailureState to always return 1 for non-healthy, got %d and %d", f1, f2)
	}
}
