package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
)

const localContainerServerID = "local"

type localContainerStatsRow struct {
	Container string `json:"Container"`
	ID        string `json:"ID"`
	Name      string `json:"Name"`
	CPUPerc   string `json:"CPUPerc"`
	MemUsage  string `json:"MemUsage"`
	NetIO     string `json:"NetIO"`
	BlockIO   string `json:"BlockIO"`
}

type localContainerCounters struct {
	ObservedAt time.Time
	NetworkIn  float64
	NetworkOut float64
	BlockRead  float64
	BlockWrite float64
}

func (o *PlatformObserver) collectLocalContainerTelemetry(ctx context.Context, now time.Time) ([]monitormetrics.MetricPoint, error) {
	if o.containerStatsFn == nil {
		return nil, nil
	}
	output, err := o.containerStatsFn(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := parseLocalContainerStatsOutput(output)
	if err != nil {
		return nil, err
	}
	points, nextSamples := buildLocalContainerMetricPoints(rows, now, o.containerSamples)
	o.containerSamples = nextSamples
	return points, nil
}

func parseLocalContainerStatsOutput(output string) ([]localContainerStatsRow, error) {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return nil, nil
	}
	lines := strings.Split(trimmed, "\n")
	rows := make([]localContainerStatsRow, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var row localContainerStatsRow
		if err := json.Unmarshal([]byte(line), &row); err != nil {
			return nil, fmt.Errorf("parse local docker stats row: %w", err)
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func buildLocalContainerMetricPoints(rows []localContainerStatsRow, observedAt time.Time, previous map[string]localContainerCounters) ([]monitormetrics.MetricPoint, map[string]localContainerCounters) {
	if previous == nil {
		previous = map[string]localContainerCounters{}
	}
	points := make([]monitormetrics.MetricPoint, 0, len(rows)*6)
	nextSamples := make(map[string]localContainerCounters, len(rows))
	for _, row := range rows {
		containerName := normalizeLocalContainerName(firstNonEmpty(row.Name, row.Container, row.ID))
		if containerName == "" {
			continue
		}
		labels := map[string]string{
			"server_id":      localContainerServerID,
			"target_type":    "container",
			"target_id":      containerName,
			"container_id":   containerName,
			"container_name": containerName,
		}
		if cpuPercent := parseDockerPercent(row.CPUPerc); cpuPercent != nil {
			points = append(points, newLocalContainerMetricPoint("appos_container_cpu_usage_percent", *cpuPercent, labels, observedAt))
		}
		memoryUsage, memoryLimit := parseDockerMemoryPair(row.MemUsage)
		if memoryUsage != nil {
			points = append(points, newLocalContainerMetricPoint("appos_container_memory_usage_bytes", *memoryUsage, labels, observedAt))
		}
		if memoryLimit != nil {
			points = append(points, newLocalContainerMetricPoint("appos_container_memory_limit_bytes", *memoryLimit, labels, observedAt))
		}
		networkIn, networkOut := parseDockerIoPair(row.NetIO)
		blockRead, blockWrite := parseDockerIoPair(row.BlockIO)
		current := localContainerCounters{
			ObservedAt: observedAt,
			NetworkIn:  valueOrZero(networkIn),
			NetworkOut: valueOrZero(networkOut),
			BlockRead:  valueOrZero(blockRead),
			BlockWrite: valueOrZero(blockWrite),
		}
		nextSamples[containerName] = current
		previousCounters, ok := previous[containerName]
		if !ok || !observedAt.After(previousCounters.ObservedAt) {
			continue
		}
		elapsedSeconds := observedAt.Sub(previousCounters.ObservedAt).Seconds()
		if elapsedSeconds <= 0 {
			continue
		}
		appendRateMetric := func(series string, currentValue float64, previousValue float64) {
			delta := currentValue - previousValue
			if delta < 0 {
				return
			}
			points = append(points, newLocalContainerMetricPoint(series, delta/elapsedSeconds, labels, observedAt))
		}
		appendRateMetric("appos_container_network_receive_bytes_per_second", current.NetworkIn, previousCounters.NetworkIn)
		appendRateMetric("appos_container_network_transmit_bytes_per_second", current.NetworkOut, previousCounters.NetworkOut)
		appendRateMetric("appos_container_block_read_bytes_per_second", current.BlockRead, previousCounters.BlockRead)
		appendRateMetric("appos_container_block_write_bytes_per_second", current.BlockWrite, previousCounters.BlockWrite)
	}
	return points, nextSamples
}

func normalizeLocalContainerName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.Split(value, ",")[0]
	return strings.TrimSpace(strings.TrimPrefix(value, "/"))
}

func newLocalContainerMetricPoint(series string, value float64, labels map[string]string, observedAt time.Time) monitormetrics.MetricPoint {
	clonedLabels := make(map[string]string, len(labels))
	for key, labelValue := range labels {
		clonedLabels[key] = labelValue
	}
	return monitormetrics.MetricPoint{
		Series:     series,
		Value:      value,
		Labels:     clonedLabels,
		ObservedAt: observedAt,
	}
}

func parseDockerPercent(value string) *float64 {
	trimmed := strings.TrimSpace(strings.TrimSuffix(value, "%"))
	if trimmed == "" {
		return nil
	}
	parsed, err := strconv.ParseFloat(trimmed, 64)
	if err != nil {
		return nil
	}
	return &parsed
}

func parseDockerMemoryPair(value string) (*float64, *float64) {
	parts := strings.Split(value, "/")
	if len(parts) == 0 {
		return nil, nil
	}
	usage := parseDockerByteValue(parts[0])
	if len(parts) == 1 {
		return usage, nil
	}
	return usage, parseDockerByteValue(parts[1])
}

func parseDockerIoPair(value string) (*float64, *float64) {
	parts := strings.Split(value, "/")
	if len(parts) == 0 {
		return nil, nil
	}
	input := parseDockerByteValue(parts[0])
	if len(parts) == 1 {
		return input, nil
	}
	return input, parseDockerByteValue(parts[1])
}

func parseDockerByteValue(value string) *float64 {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	var amount float64
	var unit string
	if _, err := fmt.Sscanf(trimmed, "%f%s", &amount, &unit); err != nil {
		return nil
	}
	multipliers := map[string]float64{
		"B":   1,
		"KB":  1000,
		"MB":  1000 * 1000,
		"GB":  1000 * 1000 * 1000,
		"TB":  1000 * 1000 * 1000 * 1000,
		"PB":  1000 * 1000 * 1000 * 1000 * 1000,
		"KIB": 1024,
		"MIB": 1024 * 1024,
		"GIB": 1024 * 1024 * 1024,
		"TIB": 1024 * 1024 * 1024 * 1024,
		"PIB": 1024 * 1024 * 1024 * 1024 * 1024,
	}
	multiplier, ok := multipliers[strings.ToUpper(unit)]
	if !ok {
		return nil
	}
	result := amount * multiplier
	return &result
}

func valueOrZero(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}
