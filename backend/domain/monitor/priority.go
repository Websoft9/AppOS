package monitor

import "strings"

// IsStrongerFailure reports whether existingStatus has a higher priority (more severe) than nextStatus.
func IsStrongerFailure(existingStatus, nextStatus string, priorityMap map[string]int) bool {
	return StatusPriorityWithMap(existingStatus, priorityMap) > StatusPriorityWithMap(nextStatus, priorityMap)
}

// StatusPriorityWithMap returns the numeric priority for a status string.
// Higher values indicate more severe failures. A custom priorityMap takes precedence over defaults.
func StatusPriorityWithMap(status string, priorityMap map[string]int) int {
	status = strings.TrimSpace(strings.ToLower(status))
	if priorityMap != nil {
		if value, ok := priorityMap[status]; ok {
			return value
		}
	}
	switch status {
	case "credential_invalid":
		return 5
	case "unreachable":
		return 4
	case "degraded":
		return 3
	case "offline":
		return 2
	case "unknown":
		return 1
	default:
		return 0
	}
}
