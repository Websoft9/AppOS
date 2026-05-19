package service

import (
	"fmt"
	"regexp"
	"strings"
)

var systemdAnsiPattern = regexp.MustCompile(`\x1b\[[0-9;]*m`)
var systemdServicePattern = regexp.MustCompile(`^[a-zA-Z0-9@._-]+(?:\.service)?$`)

type SystemdServiceItem struct {
	Name        string `json:"name"`
	LoadState   string `json:"load_state"`
	ActiveState string `json:"active_state"`
	SubState    string `json:"sub_state"`
	Description string `json:"description"`
}

func NormalizeServiceName(name string) (string, error) {
	service := strings.TrimSpace(name)
	if service == "" {
		return "", fmt.Errorf("service required")
	}
	if !systemdServicePattern.MatchString(service) {
		return "", fmt.Errorf("invalid service name")
	}
	if !strings.HasSuffix(service, ".service") {
		service += ".service"
	}
	return service, nil
}

func ValidateSystemdAction(action string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(action))
	switch normalized {
	case "start", "stop", "restart", "enable", "disable":
		return normalized, nil
	default:
		return "", fmt.Errorf("action must be start, stop, restart, enable, or disable")
	}
}

func ParseSystemdServicesOutput(raw, keyword string) []SystemdServiceItem {
	services := make([]SystemdServiceItem, 0)
	needle := strings.ToLower(strings.TrimSpace(keyword))
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(systemdAnsiPattern.ReplaceAllString(line, ""))
		if line == "" {
			continue
		}
		parts := normalizeSystemdListFields(strings.Fields(line))
		if len(parts) < 4 {
			continue
		}

		item, ok := parseSystemdListItem(parts)
		if !ok {
			continue
		}
		if needle != "" && !strings.Contains(strings.ToLower(item.Name), needle) && !strings.Contains(strings.ToLower(item.Description), needle) {
			continue
		}
		services = append(services, item)
	}
	return services
}

func ParseSystemdShowProperties(raw string) map[string]string {
	details := make(map[string]string)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		details[parts[0]] = parts[1]
	}
	return details
}

func ResolveSystemdUnitPath(raw string) (string, error) {
	unitPath := strings.TrimSpace(raw)
	if unitPath == "" || unitPath == "/dev/null" {
		return "", fmt.Errorf("systemd unit file not found")
	}
	return unitPath, nil
}

func normalizeSystemdListFields(fields []string) []string {
	normalized := make([]string, 0, len(fields))
	for _, field := range fields {
		field = strings.TrimSpace(field)
		field = strings.TrimLeft(field, "●○*•")
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		normalized = append(normalized, field)
	}
	return normalized
}

func parseSystemdListItem(parts []string) (SystemdServiceItem, bool) {
	item := SystemdServiceItem{}
	if isSystemdServiceUnit(parts[0]) && isSystemdLoadState(parts[1]) && isSystemdActiveState(parts[2]) && isSystemdSubState(parts[3]) {
		item.Name = parts[0]
		item.LoadState = parts[1]
		item.ActiveState = parts[2]
		item.SubState = parts[3]
		if len(parts) > 4 {
			item.Description = strings.Join(parts[4:], " ")
		}
		return item, true
	}
	if len(parts) == 4 && isSystemdLoadState(parts[0]) && isSystemdActiveState(parts[1]) && isSystemdSubState(parts[2]) && isSystemdServiceUnit(parts[3]) {
		item.LoadState = parts[0]
		item.ActiveState = parts[1]
		item.SubState = parts[2]
		item.Name = parts[3]
		return item, true
	}
	return SystemdServiceItem{}, false
}

func isSystemdLoadState(value string) bool {
	switch strings.ToLower(value) {
	case "loaded", "not-found", "bad-setting", "error", "masked", "merged", "stub":
		return true
	default:
		return false
	}
}

func isSystemdServiceUnit(value string) bool {
	return strings.HasSuffix(strings.ToLower(strings.TrimSpace(value)), ".service")
}

func isSystemdActiveState(value string) bool {
	switch strings.ToLower(value) {
	case "active", "reloading", "inactive", "failed", "activating", "deactivating", "maintenance":
		return true
	default:
		return false
	}
}

func isSystemdSubState(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "running", "dead", "exited", "failed", "start", "start-pre", "start-post", "stop", "stop-sigterm", "stop-sigkill", "stop-post", "auto-restart", "listening", "waiting", "elapsed", "plugged", "mounted", "remounting", "unmounting", "condition", "reload", "reload-signal", "reload-notify", "final-sigterm", "final-sigkill":
		return true
	default:
		return false
	}
}