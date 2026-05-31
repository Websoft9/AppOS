package platform

import (
	"bufio"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type localAppCoreTelemetryState struct {
	ObservedAt      time.Time
	DiskReadBytes   float64
	DiskWriteBytes  float64
	NetworkCounters map[string]localNetworkCounters
}

type LocalAppCoreTelemetryState = localAppCoreTelemetryState

type localAppCoreSnapshot struct {
	MemoryUsedBytes  float64
	MemoryAvailBytes float64
	DiskUsedBytes    float64
	DiskFreeBytes    float64
	DiskReadBytes    float64
	DiskWriteBytes   float64
	NetworkCounters  map[string]localNetworkCounters
}

func collectLocalAppCoreMetricPoints(now time.Time, previous localAppCoreTelemetryState) ([]MetricPoint, localAppCoreTelemetryState, error) {
	snapshot, err := readLocalAppCoreSnapshot()
	if err != nil {
		return nil, previous, err
	}
	points := buildLocalAppCoreMetricPoints(now, snapshot, previous)
	next := localAppCoreTelemetryState{
		ObservedAt:      now,
		DiskReadBytes:   snapshot.DiskReadBytes,
		DiskWriteBytes:  snapshot.DiskWriteBytes,
		NetworkCounters: snapshot.NetworkCounters,
	}
	return points, next, nil
}

func buildLocalAppCoreMetricPoints(now time.Time, snapshot localAppCoreSnapshot, previous localAppCoreTelemetryState) []MetricPoint {
	points := []MetricPoint{
		newLocalAppCoreMetricPoint("appos_platform_disk_usage_bytes", snapshot.DiskUsedBytes, now, nil),
		newLocalAppCoreMetricPoint("appos_platform_disk_free_bytes", snapshot.DiskFreeBytes, now, nil),
	}
	if previous.ObservedAt.IsZero() || !now.After(previous.ObservedAt) {
		return points
	}
	elapsedSeconds := now.Sub(previous.ObservedAt).Seconds()
	if elapsedSeconds <= 0 {
		return points
	}
	appendRate := func(series string, current float64, prior float64, extraLabels map[string]string) {
		delta := current - prior
		if delta < 0 {
			return
		}
		points = append(points, newLocalAppCoreMetricPoint(series, delta/elapsedSeconds, now, extraLabels))
	}
	appendRate("appos_platform_disk_read_bytes_per_second", snapshot.DiskReadBytes, previous.DiskReadBytes, nil)
	appendRate("appos_platform_disk_write_bytes_per_second", snapshot.DiskWriteBytes, previous.DiskWriteBytes, nil)
	aggregateRx := 0.0
	aggregateTx := 0.0
	interfaces := make([]string, 0, len(snapshot.NetworkCounters))
	for name := range snapshot.NetworkCounters {
		interfaces = append(interfaces, name)
	}
	sort.Strings(interfaces)
	for _, name := range interfaces {
		current := snapshot.NetworkCounters[name]
		prior, ok := previous.NetworkCounters[name]
		if !ok {
			continue
		}
		rxDelta := current.RxBytes - prior.RxBytes
		txDelta := current.TxBytes - prior.TxBytes
		if rxDelta >= 0 {
			aggregateRx += rxDelta
			points = append(points, newLocalAppCoreMetricPoint("appos_platform_network_rx_bytes_per_second", rxDelta/elapsedSeconds, now, map[string]string{"network_interface": name}))
		}
		if txDelta >= 0 {
			aggregateTx += txDelta
			points = append(points, newLocalAppCoreMetricPoint("appos_platform_network_tx_bytes_per_second", txDelta/elapsedSeconds, now, map[string]string{"network_interface": name}))
		}
	}
	points = append(points,
		newLocalAppCoreMetricPoint("appos_platform_network_rx_bytes_per_second", aggregateRx/elapsedSeconds, now, map[string]string{"network_interface": ""}),
		newLocalAppCoreMetricPoint("appos_platform_network_tx_bytes_per_second", aggregateTx/elapsedSeconds, now, map[string]string{"network_interface": ""}),
	)
	return points
}

func newLocalAppCoreMetricPoint(series string, value float64, observedAt time.Time, extraLabels map[string]string) MetricPoint {
	labels := platformMetricLabels(PlatformTargetAppOSCore)
	for key, labelValue := range extraLabels {
		labels[key] = labelValue
	}
	return MetricPoint{Series: series, Value: value, Labels: labels, ObservedAt: observedAt}
}

func readLocalAppCoreSnapshot() (localAppCoreSnapshot, error) {
	memoryUsed, memoryAvailable, _, err := readLocalAppCoreMemory()
	if err != nil {
		return localAppCoreSnapshot{}, err
	}
	diskUsed, diskFree, err := readLocalAppCoreDiskUsage()
	if err != nil {
		return localAppCoreSnapshot{}, err
	}
	diskRead, diskWrite, err := readLocalAppCoreDiskCounters()
	if err != nil {
		return localAppCoreSnapshot{}, err
	}
	networkCounters, err := readLocalAppCoreNetworkCounters()
	if err != nil {
		return localAppCoreSnapshot{}, err
	}
	return localAppCoreSnapshot{
		MemoryUsedBytes:  memoryUsed,
		MemoryAvailBytes: memoryAvailable,
		DiskUsedBytes:    diskUsed,
		DiskFreeBytes:    diskFree,
		DiskReadBytes:    diskRead,
		DiskWriteBytes:   diskWrite,
		NetworkCounters:  networkCounters,
	}, nil
}

func readLocalAppCoreMemory() (float64, float64, bool, error) {
	usedBytes, _, err := readFirstLocalAppCoreFloat(
		filepath.Join("/sys/fs/cgroup", "memory.current"),
		filepath.Join("/sys/fs/cgroup", "memory", "memory.usage_in_bytes"),
	)
	if err != nil {
		return 0, 0, false, err
	}
	limitBytes, limitFound, err := readFirstLocalAppCoreFloat(
		filepath.Join("/sys/fs/cgroup", "memory.max"),
		filepath.Join("/sys/fs/cgroup", "memory", "memory.limit_in_bytes"),
	)
	if err != nil {
		return usedBytes, 0, false, err
	}
	if !limitFound || limitBytes <= 0 || limitBytes >= (1<<60) {
		return usedBytes, 0, false, nil
	}
	availableBytes := limitBytes - usedBytes
	if availableBytes < 0 {
		availableBytes = 0
	}
	return usedBytes, availableBytes, true, nil
}

func readFirstLocalAppCoreFloat(paths ...string) (float64, bool, error) {
	for _, path := range paths {
		content, err := os.ReadFile(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return 0, false, err
		}
		trimmed := strings.TrimSpace(string(content))
		if trimmed == "" || trimmed == "max" {
			return 0, false, nil
		}
		value, err := strconv.ParseFloat(trimmed, 64)
		if err != nil {
			return 0, false, err
		}
		return value, true, nil
	}
	return 0, false, nil
}

func readLocalAppCoreDiskUsage() (float64, float64, error) {
	var stats syscall.Statfs_t
	if err := syscall.Statfs("/", &stats); err != nil {
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

func readLocalAppCoreDiskCounters() (float64, float64, error) {
	if readBytes, writeBytes, ok, err := readLocalAppCoreIOStatV2(); ok || err != nil {
		return readBytes, writeBytes, err
	}
	return readLocalAppCoreIOStatV1()
}

func readLocalAppCoreIOStatV2() (float64, float64, bool, error) {
	content, err := os.ReadFile(filepath.Join("/sys/fs/cgroup", "io.stat"))
	if err != nil {
		if os.IsNotExist(err) {
			return 0, 0, false, nil
		}
		return 0, 0, true, err
	}
	readBytes := 0.0
	writeBytes := 0.0
	parsed := false
	for _, line := range strings.Split(string(content), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 2 {
			continue
		}
		for _, field := range fields[1:] {
			key, value, ok := strings.Cut(field, "=")
			if !ok {
				continue
			}
			parsedValue, err := strconv.ParseFloat(value, 64)
			if err != nil {
				continue
			}
			switch key {
			case "rbytes":
				readBytes += parsedValue
				parsed = true
			case "wbytes":
				writeBytes += parsedValue
				parsed = true
			}
		}
	}
	if !parsed {
		return 0, 0, false, nil
	}
	return readBytes, writeBytes, true, nil
}

func readLocalAppCoreIOStatV1() (float64, float64, error) {
	paths := []string{
		filepath.Join("/sys/fs/cgroup", "blkio.io_service_bytes_recursive"),
		filepath.Join("/sys/fs/cgroup", "blkio.io_service_bytes"),
		filepath.Join("/sys/fs/cgroup", "blkio", "blkio.io_service_bytes_recursive"),
		filepath.Join("/sys/fs/cgroup", "blkio", "blkio.throttle.io_service_bytes"),
	}
	for _, candidate := range paths {
		readBytes, writeBytes, ok, err := readLocalAppCoreV1IOFile(candidate)
		if ok || err != nil {
			return readBytes, writeBytes, err
		}
	}
	return 0, 0, nil
}

func readLocalAppCoreV1IOFile(path string) (float64, float64, bool, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, 0, false, nil
		}
		return 0, 0, true, err
	}
	defer file.Close()
	readBytes := 0.0
	writeBytes := 0.0
	parsed := false
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 3 {
			continue
		}
		operation := strings.ToLower(fields[len(fields)-2])
		value, err := strconv.ParseFloat(fields[len(fields)-1], 64)
		if err != nil {
			continue
		}
		switch operation {
		case "read":
			readBytes += value
			parsed = true
		case "write":
			writeBytes += value
			parsed = true
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, 0, true, err
	}
	return readBytes, writeBytes, parsed, nil
}

func readLocalAppCoreNetworkCounters() (map[string]localNetworkCounters, error) {
	return readNetworkCounters(filepath.Join("/proc", "net", "dev"))
}

func readNetworkCounters(path string) (map[string]localNetworkCounters, error) {
	file, err := os.Open(path)
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
