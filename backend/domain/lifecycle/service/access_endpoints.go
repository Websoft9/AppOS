package service

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	"gopkg.in/yaml.v3"
)

type templateAccessExposure struct {
	Label    string
	Service  string
	Port     int
	Protocol string
	Default  bool
}

type composePortBinding struct {
	Service       string
	TargetPort    int
	PublishedPort int
	Protocol      string
}

func resolveAccessEndpoints(spec NormalizedInstallSpec) []map[string]any {
	return ResolveAccessEndpointsFromArtifacts(spec.Metadata, spec.RenderedCompose, spec.ExposureIntent)
}

func ResolveAccessEndpointsFromArtifacts(metadata map[string]any, renderedCompose string, exposureIntent *ExposureIntent) []map[string]any {
	exposures, exists := templateAccessExposures(metadata)
	if !exists {
		return nil
	}
	if exposureIntent != nil && exposureIntent.ExposureType == "internal_only" {
		return []map[string]any{}
	}
	bindings, err := composePortBindings(renderedCompose)
	if err != nil {
		return []map[string]any{}
	}
	endpoints := make([]map[string]any, 0, len(exposures))
	for _, exposure := range exposures {
		if exposure.Service == "" || exposure.Port <= 0 {
			continue
		}
		binding, ok := findComposePortBinding(bindings, exposure)
		if !ok || binding.PublishedPort <= 0 {
			continue
		}
		endpoints = append(endpoints, map[string]any{
			"label":      exposure.Label,
			"service":    exposure.Service,
			"port":       exposure.Port,
			"protocol":   exposure.Protocol,
			"serverPort": binding.PublishedPort,
			"default":    exposure.Default,
		})
	}
	return endpoints
}

func templateAccessExposures(metadata map[string]any) ([]templateAccessExposure, bool) {
	templateContext, ok := metadataMap(metadata, "template_context")
	if !ok {
		return nil, false
	}
	raw, ok := templateContext["exposures"]
	if !ok {
		return nil, false
	}
	rawItems := exposureMetadataItems(raw)
	result := make([]templateAccessExposure, 0, len(rawItems))
	for _, item := range rawItems {
		exposure := templateAccessExposure{
			Label:    strings.TrimSpace(fmt.Sprint(item["label"])),
			Service:  strings.TrimSpace(fmt.Sprint(item["service"])),
			Port:     mapIntValue(item["port"]),
			Protocol: normalizeAccessProtocol(fmt.Sprint(item["protocol"])),
			Default:  mapBoolValue(item["default"]),
		}
		if exposure.Label == "" {
			exposure.Label = exposure.Service
		}
		if exposure.Protocol == "" {
			exposure.Protocol = "http"
		}
		result = append(result, exposure)
	}
	if len(result) == 1 && !result[0].Default {
		result[0].Default = true
	}
	return result, true
}

func exposureMetadataItems(raw any) []map[string]any {
	switch typed := raw.(type) {
	case []map[string]any:
		return typed
	case []any:
		result := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if mapped, ok := item.(map[string]any); ok {
				result = append(result, mapped)
			}
		}
		return result
	default:
		return nil
	}
}

func composePortBindings(raw string) ([]composePortBinding, error) {
	var doc map[string]any
	if err := yaml.Unmarshal([]byte(raw), &doc); err != nil {
		return nil, fmt.Errorf("invalid compose yaml: %w", err)
	}
	services, _ := doc["services"].(map[string]any)
	bindings := make([]composePortBinding, 0)
	for serviceName, rawService := range services {
		service, ok := rawService.(map[string]any)
		if !ok {
			continue
		}
		rawPorts, ok := service["ports"].([]any)
		if !ok {
			continue
		}
		for _, entry := range rawPorts {
			bindings = append(bindings, extractComposePortBindings(strings.TrimSpace(serviceName), entry)...)
		}
	}
	sort.Slice(bindings, func(i, j int) bool {
		if bindings[i].Service == bindings[j].Service {
			if bindings[i].TargetPort == bindings[j].TargetPort {
				return bindings[i].Protocol < bindings[j].Protocol
			}
			return bindings[i].TargetPort < bindings[j].TargetPort
		}
		return bindings[i].Service < bindings[j].Service
	})
	return bindings, nil
}

func extractComposePortBindings(service string, entry any) []composePortBinding {
	switch typed := entry.(type) {
	case string:
		return parseComposeShortPortBinding(service, typed)
	case map[string]any:
		protocol := normalizeComposePortProtocol(fmt.Sprint(typed["protocol"]))
		published := mapIntValue(typed["published"])
		target := mapIntValue(typed["target"])
		if published <= 0 || target <= 0 {
			return nil
		}
		return []composePortBinding{{Service: service, TargetPort: target, PublishedPort: published, Protocol: protocol}}
	default:
		return nil
	}
}

func parseComposeShortPortBinding(service, value string) []composePortBinding {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	protocol := "tcp"
	if slash := strings.LastIndex(trimmed, "/"); slash >= 0 {
		protocol = normalizeComposePortProtocol(trimmed[slash+1:])
		trimmed = strings.TrimSpace(trimmed[:slash])
	}
	parts := strings.Split(trimmed, ":")
	if len(parts) < 2 {
		return nil
	}
	published := parsePortNumber(parts[len(parts)-2])
	target := parsePortNumber(parts[len(parts)-1])
	if published <= 0 || target <= 0 {
		return nil
	}
	return []composePortBinding{{Service: service, TargetPort: target, PublishedPort: published, Protocol: protocol}}
}

func findComposePortBinding(bindings []composePortBinding, exposure templateAccessExposure) (composePortBinding, bool) {
	wantedProtocol := accessProtocolTransport(exposure.Protocol)
	for _, binding := range bindings {
		if binding.Service == exposure.Service && binding.TargetPort == exposure.Port && binding.Protocol == wantedProtocol {
			return binding, true
		}
	}
	return composePortBinding{}, false
}

func metadataMap(input map[string]any, key string) (map[string]any, bool) {
	if len(input) == 0 {
		return nil, false
	}
	value, ok := input[key]
	if !ok {
		return nil, false
	}
	result, ok := value.(map[string]any)
	return result, ok
}

func normalizeAccessProtocol(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "http", "https", "tcp", "udp":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func accessProtocolTransport(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == "udp" {
		return "udp"
	}
	return "tcp"
}

func normalizeComposePortProtocol(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "udp":
		return "udp"
	default:
		return "tcp"
	}
}

func mapIntValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		return parsePortNumber(typed)
	default:
		return 0
	}
}

func mapBoolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, _ := strconv.ParseBool(strings.TrimSpace(typed))
		return parsed
	default:
		return false
	}
}

func parsePortNumber(value string) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 || parsed > 65535 {
		return 0
	}
	return parsed
}
