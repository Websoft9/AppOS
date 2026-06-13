package process

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type ResourceInfo struct {
	PID    int     `json:"pid"`
	CPU    float64 `json:"cpu"`
	Memory int64   `json:"memory"`
}

const cpuSamplingWindow = 5 * time.Second

var (
	clockTicksPerSecondOnce sync.Once
	clockTicksPerSecond     float64 = 100
)

func CPUSamplingWindow() time.Duration {
	return cpuSamplingWindow
}

func GetProcessResources(pids []int) map[int]ResourceInfo {
	result := make(map[int]ResourceInfo)
	if len(pids) == 0 {
		return result
	}

	pidSet := buildPIDSet(pids)
	if len(pidSet) == 0 {
		return result
	}

	procTicks1 := make(map[int]float64, len(pidSet))
	for pid := range pidSet {
		procTicks1[pid] = readProcTicks(pid)
	}
	sysTicks1 := readSystemTicks()

	time.Sleep(cpuSamplingWindow)

	procTicks2 := make(map[int]float64, len(pidSet))
	for pid := range pidSet {
		procTicks2[pid] = readProcTicks(pid)
	}
	sysTicks2 := readSystemTicks()

	deltaSys := sysTicks2 - sysTicks1
	numCPU := float64(runtime.NumCPU())
	rssMap := readRSSMap(pidSet)

	for pid := range pidSet {
		cpuPct := 0.0
		if deltaSys > 0 {
			deltaProc := procTicks2[pid] - procTicks1[pid]
			cpuPct = (deltaProc / deltaSys) * numCPU * 100
			if cpuPct > numCPU*100 {
				cpuPct = numCPU * 100
			}
			if cpuPct < 0 {
				cpuPct = 0
			}
		}
		result[pid] = ResourceInfo{PID: pid, CPU: cpuPct, Memory: rssMap[pid]}
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

func readProcTicks(pid int) float64 {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "stat"))
	if err != nil {
		return 0
	}
	s := string(data)
	idx := strings.LastIndex(s, ")")
	if idx < 0 || idx+2 >= len(s) {
		return 0
	}
	fields := strings.Fields(s[idx+2:])
	if len(fields) < 13 {
		return 0
	}
	utime, _ := strconv.ParseFloat(fields[11], 64)
	stime, _ := strconv.ParseFloat(fields[12], 64)
	return utime + stime
}

func readProcStartTicks(pid int) float64 {
	_, startTicks := readProcessStateAndStart(pid)
	return startTicks
}

func readSystemTicks() float64 {
	data, err := os.ReadFile(filepath.Join(procRoot, "stat"))
	if err != nil {
		return 0
	}
	lines := strings.SplitN(string(data), "\n", 2)
	if len(lines) == 0 {
		return 0
	}
	fields := strings.Fields(lines[0])
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0
	}
	total := 0.0
	for _, field := range fields[1:] {
		value, _ := strconv.ParseFloat(field, 64)
		total += value
	}
	return total
}

func readRSSMap(pidSet map[int]bool) map[int]int64 {
	rss := make(map[int]int64)
	for pid := range pidSet {
		rss[pid] = readProcRSS(pid)
	}
	return rss
}

func readProcRSS(pid int) int64 {
	status, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "status"))
	if err == nil {
		for _, line := range strings.Split(string(status), "\n") {
			if !strings.HasPrefix(line, "VmRSS:") {
				continue
			}
			fields := strings.Fields(line)
			if len(fields) < 2 {
				return 0
			}
			value, parseErr := strconv.ParseInt(fields[1], 10, 64)
			if parseErr != nil {
				return 0
			}
			return value * 1024
		}
	}

	statm, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "statm"))
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(statm))
	if len(fields) < 2 {
		return 0
	}
	pages, parseErr := strconv.ParseInt(fields[1], 10, 64)
	if parseErr != nil {
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
	if procRoot == "/proc" {
		var info syscall.Sysinfo_t
		if err := syscall.Sysinfo(&info); err == nil && info.Uptime > 0 {
			return float64(info.Uptime)
		}
	}
	file, err := os.Open(filepath.Join(procRoot, "uptime"))
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
		value, parseErr := strconv.ParseFloat(strings.TrimSpace(string(output)), 64)
		if parseErr != nil || value <= 0 {
			return
		}
		clockTicksPerSecond = value
	})
	return clockTicksPerSecond
}
