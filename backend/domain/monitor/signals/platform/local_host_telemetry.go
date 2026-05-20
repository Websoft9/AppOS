package platform

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	monitormetrics "github.com/websoft9/appos/backend/domain/monitor/metrics"
)

type MetricPoint = monitormetrics.MetricPoint

type localHostTelemetryState struct {
	ObservedAt time.Time
	CPUTotal   float64
	CPUIdle    float64
	DiskReadBytes  float64
	DiskWriteBytes float64
	Network map[string]localNetworkCounters
}

type LocalHostTelemetryState = localHostTelemetryState

type localNetworkCounters struct {
	RxBytes float64
	TxBytes float64
}

type localHostSnapshot struct {
	CPUTotal         float64
	CPUIdle          float64
	MemoryUsedBytes  float64
	MemoryAvailBytes float64
	DiskUsedBytes    float64
	DiskFreeBytes    float64
	DiskReadBytes    float64
	DiskWriteBytes   float64
	Network          map[string]localNetworkCounters
}

const localHostTargetID = PlatformTargetAppOSCore

func collectLocalHostMetricPoints(now time.Time, previous localHostTelemetryState) ([]MetricPoint, localHostTelemetryState, error) {
	snapshot, err := readLocalHostSnapshot()
	if err != nil {
		return nil, previous, err
	}
	points := buildLocalHostMetricPoints(now, snapshot, previous)
	next := localHostTelemetryState{
		ObservedAt: now,
		CPUTotal: snapshot.CPUTotal,
		CPUIdle: snapshot.CPUIdle,
		DiskReadBytes: snapshot.DiskReadBytes,
		DiskWriteBytes: snapshot.DiskWriteBytes,
		Network: snapshot.Network,
	}
	return points, next, nil
}

func buildLocalHostMetricPoints(now time.Time, snapshot localHostSnapshot, previous localHostTelemetryState) []MetricPoint {
	points := make([]MetricPoint, 0, 16)
	points = append(points,
		newLocalHostMetricPoint("appos_host_memory_bytes", snapshot.MemoryUsedBytes, now, nil),
		newLocalHostMetricPoint("appos_host_memory_available_bytes", snapshot.MemoryAvailBytes, now, nil),
		newLocalHostMetricPoint("appos_host_disk_usage_bytes", snapshot.DiskUsedBytes, now, nil),
		newLocalHostMetricPoint("appos_host_disk_free_bytes", snapshot.DiskFreeBytes, now, nil),
	)
	if previous.ObservedAt.IsZero() || !now.After(previous.ObservedAt) {
		return points
	}
	elapsedSeconds := now.Sub(previous.ObservedAt).Seconds()
	if elapsedSeconds <= 0 {
		return points
	}
	if deltaTotal := snapshot.CPUTotal - previous.CPUTotal; deltaTotal > 0 {
		deltaIdle := snapshot.CPUIdle - previous.CPUIdle
		cpuUsage := (1 - maxFloat64(deltaIdle, 0)/deltaTotal) * 100
		if cpuUsage < 0 {
			cpuUsage = 0
		}
		if cpuUsage > 100 {
			cpuUsage = 100
		}
		points = append(points, newLocalHostMetricPoint("appos_host_cpu_usage", cpuUsage, now, nil))
	}
	appendRate := func(series string, current float64, prior float64, extraLabels map[string]string) {
		delta := current - prior
		if delta < 0 {
			return
		}
		points = append(points, newLocalHostMetricPoint(series, delta/elapsedSeconds, now, extraLabels))
	}
	appendRate("appos_host_disk_read_bytes_per_second", snapshot.DiskReadBytes, previous.DiskReadBytes, nil)
	appendRate("appos_host_disk_write_bytes_per_second", snapshot.DiskWriteBytes, previous.DiskWriteBytes, nil)
	aggregateRx := 0.0
	aggregateTx := 0.0
	interfaces := make([]string, 0, len(snapshot.Network))
	for name := range snapshot.Network {
		interfaces = append(interfaces, name)
	}
	sort.Strings(interfaces)
	for _, name := range interfaces {
		current := snapshot.Network[name]
		prior, ok := previous.Network[name]
		if !ok {
			continue
		}
		rxDelta := current.RxBytes - prior.RxBytes
		txDelta := current.TxBytes - prior.TxBytes
		if rxDelta >= 0 {
			aggregateRx += rxDelta
			points = append(points, newLocalHostMetricPoint("appos_host_network_rx_bytes_per_second", rxDelta/elapsedSeconds, now, map[string]string{"network_interface": name}))
		}
		if txDelta >= 0 {
			aggregateTx += txDelta
			points = append(points, newLocalHostMetricPoint("appos_host_network_tx_bytes_per_second", txDelta/elapsedSeconds, now, map[string]string{"network_interface": name}))
		}
	}
	points = append(points,
		newLocalHostMetricPoint("appos_host_network_rx_bytes_per_second", aggregateRx/elapsedSeconds, now, map[string]string{"network_interface": ""}),
		newLocalHostMetricPoint("appos_host_network_tx_bytes_per_second", aggregateTx/elapsedSeconds, now, map[string]string{"network_interface": ""}),
	)
	return points
}

func newLocalHostMetricPoint(series string, value float64, observedAt time.Time, extraLabels map[string]string) MetricPoint {
	labels := map[string]string{
		"server_id":   localHostTargetID,
		"target_type": "server",
		"target_id":   localHostTargetID,
	}
	for key, labelValue := range extraLabels {
		labels[key] = labelValue
	}
	return MetricPoint{Series: series, Value: value, Labels: labels, ObservedAt: observedAt}
}

func readLocalHostSnapshot() (localHostSnapshot, error) {
	cpuTotal, cpuIdle, err := readHostCPUTicks()
	if err != nil {
		return localHostSnapshot{}, err
	}
	memoryUsed, memoryAvailable, err := readHostMemory()
	if err != nil {
		return localHostSnapshot{}, err
	}
	diskUsed, diskFree, err := readHostDiskUsage()
	if err != nil {
		return localHostSnapshot{}, err
	}
	diskRead, diskWrite, err := readHostDiskCounters()
	if err != nil {
		return localHostSnapshot{}, err
	}
	network, err := readHostNetworkCounters()
	if err != nil {
		return localHostSnapshot{}, err
	}
	return localHostSnapshot{
		CPUTotal: cpuTotal,
		CPUIdle: cpuIdle,
		MemoryUsedBytes: memoryUsed,
		MemoryAvailBytes: memoryAvailable,
		DiskUsedBytes: diskUsed,
		DiskFreeBytes: diskFree,
		DiskReadBytes: diskRead,
		DiskWriteBytes: diskWrite,
		Network: network,
	}, nil
}

func readHostCPUTicks() (float64, float64, error) {
	file, err := os.Open(resolveHostProcPath("stat"))
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		if err := scanner.Err(); err != nil {
			return 0, 0, err
		}
		return 0, 0, fmt.Errorf("host proc stat empty")
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0, fmt.Errorf("unexpected host proc stat header")
	}
	total := 0.0
	values := make([]float64, 0, len(fields)-1)
	for _, field := range fields[1:] {
		parsed, err := strconv.ParseFloat(field, 64)
		if err != nil {
			return 0, 0, err
		}
		values = append(values, parsed)
		total += parsed
	}
	idle := values[3]
	if len(values) > 4 {
		idle += values[4]
	}
	return total, idle, nil
}

func readHostMemory() (float64, float64, error) {
	file, err := os.Open(resolveHostProcPath("meminfo"))
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()
	var totalKB float64
	var availableKB float64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		value, err := strconv.ParseFloat(parts[1], 64)
		if err != nil {
			continue
		}
		switch parts[0] {
		case "MemTotal:":
			totalKB = value
		case "MemAvailable:":
			availableKB = value
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, 0, err
	}
	if totalKB <= 0 {
		return 0, 0, fmt.Errorf("host memory total unavailable")
	}
	usedBytes := maxFloat64((totalKB-availableKB)*1024, 0)
	return usedBytes, availableKB * 1024, nil
}

func readHostDiskUsage() (float64, float64, error) {
	statPath := "/proc/1/root"
	if _, err := os.Stat(statPath); err != nil {
		statPath = resolveHostProcPath(filepath.Join("1", "root"))
	}
	var stats syscall.Statfs_t
	if err := syscall.Statfs(statPath, &stats); err != nil {
		return 0, 0, err
	}
	total := float64(stats.Blocks) * float64(stats.Bsize)
	free := float64(stats.Bavail) * float64(stats.Bsize)
	used := total - (float64(stats.Bfree) * float64(stats.Bsize))
	if used < 0 {
		used = 0
	}
	return used, free, nil
}

func readHostDiskCounters() (float64, float64, error) {
	allowedDevices, err := listHostBlockDevices()
	if err != nil {
		return 0, 0, err
	}
	file, err := os.Open(resolveHostProcPath("diskstats"))
	if err != nil {
		return 0, 0, err
	}
	defer file.Close()
	readBytes := 0.0
	writeBytes := 0.0
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 10 {
			continue
		}
		name := fields[2]
		if _, ok := allowedDevices[name]; !ok {
			continue
		}
		readSectors, err1 := strconv.ParseFloat(fields[5], 64)
		writeSectors, err2 := strconv.ParseFloat(fields[9], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		readBytes += readSectors * 512
		writeBytes += writeSectors * 512
	}
	if err := scanner.Err(); err != nil {
		return 0, 0, err
	}
	return readBytes, writeBytes, nil
}

func readHostNetworkCounters() (map[string]localNetworkCounters, error) {
	file, err := os.Open(resolveHostProcPath(filepath.Join("net", "dev")))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	result := map[string]localNetworkCounters{}
	scanner := bufio.NewScanner(file)
	lineNumber := 0
	for scanner.Scan() {
		lineNumber++
		if lineNumber <= 2 {
			continue
		}
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		if name == "" || name == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}
		rxBytes, err1 := strconv.ParseFloat(fields[0], 64)
		txBytes, err2 := strconv.ParseFloat(fields[8], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		result[name] = localNetworkCounters{RxBytes: rxBytes, TxBytes: txBytes}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func listHostBlockDevices() (map[string]struct{}, error) {
	root := resolveHostSysPath("block")
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	result := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") || strings.HasPrefix(name, "fd") || strings.HasPrefix(name, "sr") {
			continue
		}
		result[name] = struct{}{}
	}
	return result, nil
}

func resolveHostProcPath(relative string) string {
	candidate := filepath.Join("/host/proc", relative)
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}
	return filepath.Join("/proc", relative)
}

func resolveHostSysPath(relative string) string {
	candidate := filepath.Join("/host/sys", relative)
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}
	return filepath.Join("/sys", relative)
}

func maxFloat64(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
}