package checks

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/resource/instances"
)

type ReachabilityResult struct {
	Status    string
	LatencyMS int64
	Reason    string
	Protocol  string
	Host      string
	Port      int
}

func ProbeInstanceReachability(item *instances.Instance) ReachabilityResult {
	host, port, err := InstanceProbeTarget(item.Endpoint(), item.Kind())
	if err != nil {
		return ReachabilityResult{
			Status:   "unknown",
			Reason:   err.Error(),
			Protocol: "tcp",
			Host:     host,
			Port:     port,
		}
	}

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	start := time.Now()
	conn, dialErr := net.DialTimeout("tcp", addr, 3*time.Second)
	if dialErr != nil {
		return ReachabilityResult{
			Status:   "offline",
			Reason:   dialErr.Error(),
			Protocol: "tcp",
			Host:     host,
			Port:     port,
		}
	}
	_ = conn.Close()
	return ReachabilityResult{
		Status:    "online",
		LatencyMS: time.Since(start).Milliseconds(),
		Protocol:  "tcp",
		Host:      host,
		Port:      port,
	}
}

func InstanceProbeTarget(endpoint string, kind string) (string, int, error) {
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		return "", 0, errors.New("instance endpoint is empty")
	}

	if strings.Contains(raw, "://") {
		parsed, err := url.Parse(raw)
		if err != nil {
			return "", 0, fmt.Errorf("invalid instance endpoint: %w", err)
		}
		host := strings.TrimSpace(parsed.Hostname())
		if host == "" {
			return "", 0, errors.New("instance endpoint host is empty")
		}
		if parsed.Port() != "" {
			port, err := strconv.Atoi(parsed.Port())
			if err != nil {
				return "", 0, errors.New("instance endpoint port is invalid")
			}
			return host, port, nil
		}
		if port := defaultInstanceProbePort(kind, parsed.Scheme); port > 0 {
			return host, port, nil
		}
		return "", 0, errors.New("instance endpoint port is empty")
	}

	host, portText, err := net.SplitHostPort(raw)
	if err == nil {
		port, convErr := strconv.Atoi(portText)
		if convErr != nil {
			return "", 0, errors.New("instance endpoint port is invalid")
		}
		return host, port, nil
	}

	if port := defaultInstanceProbePort(kind, ""); port > 0 {
		return raw, port, nil
	}

	return "", 0, errors.New("instance endpoint port is empty")
}

func defaultInstanceProbePort(kind string, scheme string) int {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case instances.KindMySQL:
		return 3306
	case instances.KindPostgres:
		return 5432
	case instances.KindRedis:
		return 6379
	case instances.KindKafka:
		return 9092
	case instances.KindOllama:
		return 11434
	}

	switch strings.ToLower(strings.TrimSpace(scheme)) {
	case "https":
		return 443
	case "http":
		return 80
	}

	return 0
}
