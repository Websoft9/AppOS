package supervisor

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ResourceInfo holds CPU and memory usage for a process.
type ResourceInfo struct {
	PID    int     `json:"pid"`
	CPU    float64 `json:"cpu"`    // percentage (two-sample delta over 200ms)
	Memory int64   `json:"memory"` // RSS in bytes
}

// GetProcessResources returns CPU (two-sample) and RSS memory for given PIDs.
// Uses BusyBox-compatible ps for memory, /proc for CPU.
func GetProcessResources(pids []int) map[int]ResourceInfo {
	result := make(map[int]ResourceInfo)
	if len(pids) == 0 {
		return result
	}

	// Build lookup set
	pidSet := make(map[int]bool, len(pids))
	for _, pid := range pids {
		if pid > 0 {
			pidSet[pid] = true
		}
	}
	if len(pidSet) == 0 {
		return result
	}

	// ── CPU: two-sample approach ────────────────────────
	// Sample 1: read process ticks + total system ticks
	procTicks1 := make(map[int]float64, len(pidSet))
	for pid := range pidSet {
		procTicks1[pid] = readProcTicks(pid)
	}
	sysTicks1 := readSystemTicks()

	time.Sleep(200 * time.Millisecond)

	// Sample 2
	procTicks2 := make(map[int]float64, len(pidSet))
	for pid := range pidSet {
		procTicks2[pid] = readProcTicks(pid)
	}
	sysTicks2 := readSystemTicks()

	deltaSys := sysTicks2 - sysTicks1
	numCPU := float64(runtime.NumCPU())

	// ── Memory: from ps ─────────────────────────────────
	rssMap := readRSSMap(pidSet)

	// ── Combine results ─────────────────────────────────
	for pid := range pidSet {
		cpuPct := 0.0
		if deltaSys > 0 {
			deltaProc := procTicks2[pid] - procTicks1[pid]
			// Normalize: 100% = one full core (matches top behavior)
			cpuPct = (deltaProc / deltaSys) * numCPU * 100
			if cpuPct > numCPU*100 {
				cpuPct = numCPU * 100
			}
			if cpuPct < 0 {
				cpuPct = 0
			}
		}
		result[pid] = ResourceInfo{
			PID:    pid,
			CPU:    cpuPct,
			Memory: rssMap[pid],
		}
	}

	return result
}

// readProcTicks reads utime + stime from /proc/<pid>/stat.
func readProcTicks(pid int) float64 {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0
	}
	s := string(data)
	idx := strings.LastIndex(s, ")")
	if idx < 0 || idx+2 >= len(s) {
		return 0
	}
	fields := strings.Fields(s[idx+2:])
	// fields[0]=state, fields[11]=utime, fields[12]=stime (0-indexed after state)
	if len(fields) < 13 {
		return 0
	}
	utime, _ := strconv.ParseFloat(fields[11], 64)
	stime, _ := strconv.ParseFloat(fields[12], 64)
	return utime + stime
}

// readSystemTicks reads the total CPU ticks from /proc/stat (first "cpu" line).
func readSystemTicks() float64 {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	// First line: cpu  user nice system idle iowait irq softirq steal ...
	lines := strings.SplitN(string(data), "\n", 2)
	if len(lines) == 0 {
		return 0
	}
	fields := strings.Fields(lines[0])
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0
	}
	total := 0.0
	for _, f := range fields[1:] {
		v, _ := strconv.ParseFloat(f, 64)
		total += v
	}
	return total
}

// readRSSMap returns RSS (in bytes) for each PID using BusyBox-compatible ps.
func readRSSMap(pidSet map[int]bool) map[int]int64 {
	rss := make(map[int]int64)
	out, err := exec.Command("ps", "-o", "pid,rss").Output()
	if err != nil {
		return rss
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		pid, err := strconv.Atoi(fields[0])
		if err != nil || !pidSet[pid] {
			continue
		}
		rss[pid] = parseRSS(fields[1])
	}
	return rss
}

// parseRSS handles BusyBox ps RSS output which may have suffixes like "25m".
func parseRSS(s string) int64 {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0
	}
	// BusyBox may report "25m" (megabytes) or plain KB number
	multiplier := int64(1024) // default: value in KB → bytes
	lower := strings.ToLower(s)
	if strings.HasSuffix(lower, "m") {
		s = s[:len(s)-1]
		multiplier = 1024 * 1024 // megabytes → bytes
	} else if strings.HasSuffix(lower, "g") {
		s = s[:len(s)-1]
		multiplier = 1024 * 1024 * 1024
	} else if strings.HasSuffix(lower, "k") {
		s = s[:len(s)-1]
		multiplier = 1024
	}
	val, _ := strconv.ParseInt(s, 10, 64)
	return val * multiplier
}
