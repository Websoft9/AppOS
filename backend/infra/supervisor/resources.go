package supervisor

import (
	"bufio"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// ResourceInfo holds CPU and memory usage for a process.
type ResourceInfo struct {
	PID    int     `json:"pid"`
	CPU    float64 `json:"cpu"`    // percentage (two-sample delta over 5s)
	Memory int64   `json:"memory"` // RSS in bytes
}

const cpuSamplingWindow = 5 * time.Second

var (
	clockTicksPerSecondOnce sync.Once
	clockTicksPerSecond     float64 = 100
)

func CPUSamplingWindow() time.Duration {
	return cpuSamplingWindow
}

// GetProcessResources returns CPU (two-sample) and RSS memory for given PIDs.
// Uses /proc for both CPU and memory collection.
func GetProcessResources(pids []int) map[int]ResourceInfo {
	result := make(map[int]ResourceInfo)
	if len(pids) == 0 {
		return result
	}

	// Build lookup set
	pidSet := buildPIDSet(pids)
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

	time.Sleep(cpuSamplingWindow)

	// Sample 2
	procTicks2 := make(map[int]float64, len(pidSet))
	for pid := range pidSet {
		procTicks2[pid] = readProcTicks(pid)
	}
	sysTicks2 := readSystemTicks()

	deltaSys := sysTicks2 - sysTicks1
	numCPU := float64(runtime.NumCPU())

	// ── Memory: from /proc ──────────────────────────────
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

func GetProcessMemory(pids []int) map[int]int64 {
	pidSet := buildPIDSet(pids)
	if len(pidSet) == 0 {
		return map[int]int64{}
	}
	return readRSSMap(pidSet)
}

func GetProcessUptime(pids []int) map[int]int64 {
	pidSet := buildPIDSet(pids)
	if len(pidSet) == 0 {
		return map[int]int64{}
	}
	return readUptimeMap(pidSet)
}

func buildPIDSet(pids []int) map[int]bool {
	pidSet := make(map[int]bool, len(pids))
	for _, pid := range pids {
		if pid > 0 {
			pidSet[pid] = true
		}
	}
	return pidSet
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

func readProcStartTicks(pid int) float64 {
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
	// fields[19] is starttime after the comm/state prefix is removed.
	if len(fields) < 20 {
		return 0
	}
	startTicks, _ := strconv.ParseFloat(fields[19], 64)
	return startTicks
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

// readRSSMap returns RSS (in bytes) for each PID via /proc.
func readRSSMap(pidSet map[int]bool) map[int]int64 {
	rss := make(map[int]int64)
	for pid := range pidSet {
		rss[pid] = readProcRSS(pid)
	}
	return rss
}

func readProcRSS(pid int) int64 {
	status, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err == nil {
		for _, line := range strings.Split(string(status), "\n") {
			if !strings.HasPrefix(line, "VmRSS:") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 2 {
				return 0
			}
			value, err := strconv.ParseInt(fields[1], 10, 64)
			if err != nil {
				return 0
			}
			return value * 1024
		}
	}

	statm, err := os.ReadFile(fmt.Sprintf("/proc/%d/statm", pid))
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(statm))
	if len(fields) < 2 {
		return 0
	}
	pages, err := strconv.ParseInt(fields[1], 10, 64)
	if err != nil {
		return 0
	}
	return pages * int64(os.Getpagesize())
}

func readUptimeMap(pidSet map[int]bool) map[int]int64 {
	result := make(map[int]int64, len(pidSet))
	systemUptime := readSystemUptimeSeconds()
	clockTicks := readClockTicksPerSecond()
	if systemUptime <= 0 || clockTicks <= 0 {
		return result
	}
	for pid := range pidSet {
		startTicks := readProcStartTicks(pid)
		if startTicks <= 0 {
			continue
		}
		uptime := int64(systemUptime - (startTicks / clockTicks))
		if uptime < 0 {
			uptime = 0
		}
		result[pid] = uptime
	}
	return result
}

func readSystemUptimeSeconds() float64 {
	var info syscall.Sysinfo_t
	if err := syscall.Sysinfo(&info); err == nil && info.Uptime > 0 {
		return float64(info.Uptime)
	}
	file, err := os.Open("/proc/uptime")
	if err != nil {
		return 0
	}
	defer file.Close()
	reader := bufio.NewReader(file)
	line, err := reader.ReadString('\n')
	if err != nil && len(line) == 0 {
		return 0
	}
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return 0
	}
	value, _ := strconv.ParseFloat(fields[0], 64)
	return value
}

func readClockTicksPerSecond() float64 {
	clockTicksPerSecondOnce.Do(func() {
		output, err := exec.Command("getconf", "CLK_TCK").Output()
		if err != nil {
			return
		}
		value, err := strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
		if err != nil || value <= 0 {
			return
		}
		clockTicksPerSecond = value
	})
	return clockTicksPerSecond
}
