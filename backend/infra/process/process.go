package process

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type ProcessInfo struct {
	Name      string `json:"name"`
	StateName string `json:"stateName"`
	PID       int    `json:"pid"`
	Uptime    int64  `json:"uptime"`
}

type MatchTarget struct {
	Name    string
	Program string
}

type matchedCandidate struct {
	info       ProcessInfo
	startTicks float64
}

var procRoot = "/proc"

func SetProcRootForTesting(root string) func() {
	previous := procRoot
	procRoot = root
	return func() {
		procRoot = previous
	}
}

func ListMatchedProcesses(targets []MatchTarget) ([]ProcessInfo, error) {
	if len(targets) == 0 {
		return []ProcessInfo{}, nil
	}

	entries, err := os.ReadDir(procRoot)
	if err != nil {
		return nil, fmt.Errorf("read procfs: %w", err)
	}

	targetByName := make(map[string]MatchTarget, len(targets))
	programOwners := map[string][]MatchTarget{}
	for _, target := range targets {
		name := strings.TrimSpace(target.Name)
		program := strings.TrimSpace(target.Program)
		if name == "" || program == "" {
			continue
		}
		normalizedProgram := normalizeProcessToken(program)
		targetByName[name] = MatchTarget{Name: name, Program: program}
		programOwners[normalizedProgram] = append(programOwners[normalizedProgram], MatchTarget{Name: name, Program: program})
	}
	if len(targetByName) == 0 {
		return []ProcessInfo{}, nil
	}

	selected := map[string]matchedCandidate{}
	for _, entry := range entries {
		pid, ok := parseProcPID(entry.Name())
		if !ok {
			continue
		}

		identityTokens := readProcessIdentity(pid)
		if len(identityTokens) == 0 {
			continue
		}

		matchedNames := map[string]struct{}{}
		for _, token := range identityTokens {
			for _, owner := range programOwners[token] {
				matchedNames[owner.Name] = struct{}{}
			}
		}
		if len(matchedNames) == 0 {
			continue
		}

		stateCode, startTicks := readProcessStateAndStart(pid)
		mappedState := mapProcessState(stateCode)
		for name := range matchedNames {
			target := targetByName[name]
			candidate := matchedCandidate{
				info: ProcessInfo{
					Name:      target.Name,
					StateName: mappedState,
					PID:       pid,
				},
				startTicks: startTicks,
			}
			if existing, exists := selected[name]; !exists || shouldPreferCandidate(candidate, existing) {
				selected[name] = candidate
			}
		}
	}

	pids := make([]int, 0, len(selected))
	for _, candidate := range selected {
		if candidate.info.PID > 0 {
			pids = append(pids, candidate.info.PID)
		}
	}
	uptimeByPID := GetProcessUptime(pids)

	items := make([]ProcessInfo, 0, len(selected))
	for _, target := range targets {
		candidate, exists := selected[strings.TrimSpace(target.Name)]
		if !exists {
			continue
		}
		candidate.info.Uptime = uptimeByPID[candidate.info.PID]
		items = append(items, candidate.info)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].Name < items[j].Name
	})
	return items, nil
}

func readProcessIdentity(pid int) []string {
	tokens := map[string]struct{}{}
	addProcessToken(tokens, readProcessComm(pid))
	addProcessToken(tokens, readProcessExecutable(pid))
	addProcessToken(tokens, readProcessCommandBase(pid))
	items := make([]string, 0, len(tokens))
	for token := range tokens {
		items = append(items, token)
	}
	sort.Strings(items)
	return items
}

func addProcessToken(tokens map[string]struct{}, raw string) {
	normalized := normalizeProcessToken(raw)
	if normalized == "" {
		return
	}
	tokens[normalized] = struct{}{}
}

func normalizeProcessToken(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	value = filepath.Base(value)
	if index := strings.Index(value, ":"); index >= 0 {
		value = value[:index]
	}
	return strings.ToLower(strings.TrimSpace(value))
}

func parseProcPID(name string) (int, bool) {
	pid, err := strconv.Atoi(name)
	if err != nil || pid <= 0 {
		return 0, false
	}
	return pid, true
}

func readProcessComm(pid int) string {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "comm"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func readProcessExecutable(pid int) string {
	path, err := os.Readlink(filepath.Join(procRoot, strconv.Itoa(pid), "exe"))
	if err != nil {
		return ""
	}
	return path
}

func readProcessCommandBase(pid int) string {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "cmdline"))
	if err != nil || len(data) == 0 {
		return ""
	}
	parts := strings.Split(string(data), "\x00")
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func readProcessStateAndStart(pid int) (string, float64) {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "stat"))
	if err != nil {
		return "", 0
	}
	s := string(data)
	idx := strings.LastIndex(s, ")")
	if idx < 0 || idx+2 >= len(s) {
		return "", 0
	}
	fields := strings.Fields(s[idx+2:])
	if len(fields) < 20 {
		return "", 0
	}
	startTicks, _ := strconv.ParseFloat(fields[19], 64)
	return fields[0], startTicks
}

func shouldPreferCandidate(candidate matchedCandidate, existing matchedCandidate) bool {
	if candidate.startTicks > 0 && existing.startTicks > 0 && candidate.startTicks != existing.startTicks {
		return candidate.startTicks < existing.startTicks
	}
	return candidate.info.PID < existing.info.PID
}

func mapProcessState(code string) string {
	switch strings.TrimSpace(code) {
	case "R":
		return "running"
	case "S":
		return "sleeping"
	case "D":
		return "uninterruptible"
	case "T", "t":
		return "stopped"
	case "Z":
		return "zombie"
	case "X", "x":
		return "dead"
	case "I":
		return "idle"
	default:
		return "unknown"
	}
}