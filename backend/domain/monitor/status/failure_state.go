package status

import (
	"strings"
	"time"
)

// FailureStateFromPrevious computes the new consecutive failure count and
// success/failure timestamps based on the previous failure count and the new status.
func FailureStateFromPrevious(previousFailures int, status, healthyStatus string, now time.Time) (int, *time.Time, *time.Time) {
	failures := previousFailures
	lastSuccessAt := (*time.Time)(nil)
	lastFailureAt := (*time.Time)(nil)
	if strings.EqualFold(strings.TrimSpace(status), strings.TrimSpace(healthyStatus)) {
		failures = 0
		lastSuccessAt = &now
	} else {
		failures++
		lastFailureAt = &now
	}
	return failures, lastSuccessAt, lastFailureAt
}

// SingleObservationFailureState computes failure state for a single observation
// (no accumulated history), e.g. for platform self-checks.
func SingleObservationFailureState(status, healthyStatus string, now time.Time) (int, *time.Time, *time.Time) {
	lastSuccessAt := (*time.Time)(nil)
	lastFailureAt := (*time.Time)(nil)
	if strings.EqualFold(strings.TrimSpace(status), strings.TrimSpace(healthyStatus)) {
		lastSuccessAt = &now
		return 0, lastSuccessAt, lastFailureAt
	}
	lastFailureAt = &now
	return 1, lastSuccessAt, lastFailureAt
}
