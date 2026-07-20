package routes

import (
	"strings"
	"time"

	"github.com/websoft9/appos/backend/domain/monitor"
	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
)

func newCanonicalServerMetricPoint(series string, value float64, serverID string, observedAt time.Time) monitormetrics.MetricPoint {
	return newCanonicalServerMetricPointWithLabels(series, value, serverID, observedAt, nil)
}

func newCanonicalServerMetricPointWithLabels(series string, value float64, serverID string, observedAt time.Time, extraLabels map[string]string) monitormetrics.MetricPoint {
	labels := map[string]string{
		"server_id":   strings.TrimSpace(serverID),
		"target_type": monitor.TargetTypeServer,
		"target_id":   strings.TrimSpace(serverID),
	}
	for key, labelValue := range extraLabels {
		labels[key] = labelValue
	}
	return monitormetrics.MetricPoint{Series: series, Value: value, Labels: labels, ObservedAt: observedAt.UTC()}
}

func newCanonicalContainerMetricPoint(series string, value float64, serverID string, observedAt time.Time, rawLabels map[string]string) (monitormetrics.MetricPoint, bool) {
	identity := resolveContainerMetricIdentity(rawLabels)
	if identity == "" {
		return monitormetrics.MetricPoint{}, false
	}
	labels := map[string]string{
		"server_id":    strings.TrimSpace(serverID),
		"target_type":  monitor.TargetTypeContainer,
		"target_id":    identity,
		"container_id": identity,
	}
	if containerName := normalizeContainerMetricName(firstNonEmptyLabel(rawLabels, "container_name", "name")); containerName != "" {
		labels["container_name"] = containerName
	}
	if composeProject := strings.TrimSpace(firstNonEmptyLabel(rawLabels, "compose_project", "com_docker_compose_project", "com.docker.compose.project")); composeProject != "" {
		labels["compose_project"] = composeProject
	}
	if composeService := strings.TrimSpace(firstNonEmptyLabel(rawLabels, "compose_service", "com_docker_compose_service", "com.docker.compose.service")); composeService != "" {
		labels["compose_service"] = composeService
	}
	if containerStatus := strings.TrimSpace(firstNonEmptyLabel(rawLabels, "container_status", "container_state", "state", "status")); containerStatus != "" {
		labels["container_status"] = containerStatus
	}
	return monitormetrics.MetricPoint{Series: series, Value: value, Labels: labels, ObservedAt: observedAt.UTC()}, true
}

func resolveContainerMetricIdentity(labels map[string]string) string {
	if containerName := normalizeContainerMetricName(firstNonEmptyLabel(labels, "container_name", "name")); containerName != "" {
		return containerName
	}
	return normalizeContainerMetricName(firstNonEmptyLabel(labels, "container_id"))
}

func normalizeContainerMetricName(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "/")
	return strings.TrimSpace(value)
}

func firstNonEmptyLabel(labels map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(labels[key]); value != "" {
			return value
		}
	}
	return ""
}
