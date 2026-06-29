package instances

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
)

type ProbeTarget struct {
	Host   string
	Port   int
	Scheme string
}

func ResolveProbeTarget(item *Instance) (ProbeTarget, error) {
	if item == nil {
		return ProbeTarget{}, errors.New("instance is nil")
	}
	return resolveProbeTarget(item.Endpoint(), item.Kind(), item.TemplateID())
}

func resolveProbeTarget(endpoint string, kind string, templateID string) (ProbeTarget, error) {
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		return ProbeTarget{}, errors.New("instance endpoint is empty")
	}

	if strings.Contains(raw, "://") {
		parsed, err := url.Parse(raw)
		if err != nil {
			return ProbeTarget{}, fmt.Errorf("invalid instance endpoint: %w", err)
		}
		host := strings.TrimSpace(parsed.Hostname())
		if host == "" {
			return ProbeTarget{}, errors.New("instance endpoint host is empty")
		}
		if parsed.Port() != "" {
			port, err := strconv.Atoi(parsed.Port())
			if err != nil {
				return ProbeTarget{}, errors.New("instance endpoint port is invalid")
			}
			return ProbeTarget{Host: host, Port: port, Scheme: strings.TrimSpace(parsed.Scheme)}, nil
		}
		if port := resolveDefaultProbePort(kind, templateID, parsed.Scheme); port > 0 {
			return ProbeTarget{Host: host, Port: port, Scheme: strings.TrimSpace(parsed.Scheme)}, nil
		}
		return ProbeTarget{}, errors.New("instance endpoint port is empty")
	}

	host, portText, err := net.SplitHostPort(raw)
	if err == nil {
		port, convErr := strconv.Atoi(portText)
		if convErr != nil {
			return ProbeTarget{}, errors.New("instance endpoint port is invalid")
		}
		return ProbeTarget{Host: host, Port: port}, nil
	}

	if port := resolveDefaultProbePort(kind, templateID, ""); port > 0 {
		return ProbeTarget{Host: raw, Port: port}, nil
	}

	return ProbeTarget{}, errors.New("instance endpoint port is empty")
}

func resolveDefaultProbePort(kind string, templateID string, scheme string) int {
	if port := templateDefaultProbePort(templateID); port > 0 {
		return port
	}
	if port := kindDefaultProbePort(kind); port > 0 {
		return port
	}
	return schemeDefaultProbePort(scheme)
}

func templateDefaultProbePort(templateID string) int {
	normalizedTemplateID := NormalizeTemplateID(templateID)
	if normalizedTemplateID == "" {
		return 0
	}
	template, ok, err := FindTemplate(normalizedTemplateID)
	if err != nil || !ok {
		return 0
	}
	return probePortFromEndpoint(template.DefaultEndpoint)
}

func kindDefaultProbePort(kind string) int {
	contract, ok := FindKindContract(kind)
	if !ok {
		return 0
	}
	return contract.DefaultProbePort
}

func schemeDefaultProbePort(scheme string) int {
	switch strings.ToLower(strings.TrimSpace(scheme)) {
	case "https":
		return 443
	case "http":
		return 80
	default:
		return 0
	}
}

func probePortFromEndpoint(endpoint string) int {
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		return 0
	}
	if strings.Contains(raw, "://") {
		parsed, err := url.Parse(raw)
		if err != nil {
			return 0
		}
		if parsed.Port() != "" {
			port, err := strconv.Atoi(parsed.Port())
			if err == nil {
				return port
			}
		}
		return schemeDefaultProbePort(parsed.Scheme)
	}
	_, portText, err := net.SplitHostPort(raw)
	if err != nil {
		return 0
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		return 0
	}
	return port
}