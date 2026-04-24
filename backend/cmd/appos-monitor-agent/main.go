package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"gopkg.in/yaml.v3"
)

var version = "dev"

const (
	defaultConfigPath        = "/etc/appos-monitor-agent.yaml"
	defaultInterval          = 30 * time.Second
	defaultRequestTimeout    = 10 * time.Second
	serverTargetType         = "server"
	statusHealthy            = "healthy"
	hostCPUMetric            = "appos_host_cpu_usage"
	hostMemoryMetric         = "appos_host_memory_bytes"
	runtimeStateRunning      = "running"
	dockerCommandTimeout     = 5 * time.Second
	initialCPUWarmupInterval = 250 * time.Millisecond
)

type config struct {
	ServerID      string        `yaml:"server_id"`
	Interval      durationValue `yaml:"interval"`
	IngestBaseURL string        `yaml:"ingest_base_url"`
	Token         string        `yaml:"token"`
	Timeout       durationValue `yaml:"timeout"`
}

type durationValue struct {
	time.Duration
}

func (d *durationValue) UnmarshalYAML(value *yaml.Node) error {
	if value == nil {
		return nil
	}
	switch value.Kind {
	case yaml.ScalarNode:
		if value.Tag == "!!int" {
			seconds, err := strconv.Atoi(strings.TrimSpace(value.Value))
			if err != nil {
				return err
			}
			d.Duration = time.Duration(seconds) * time.Second
			return nil
		}
		duration, err := time.ParseDuration(strings.TrimSpace(value.Value))
		if err != nil {
			return err
		}
		d.Duration = duration
		return nil
	default:
		return fmt.Errorf("invalid duration value")
	}
}

type agent struct {
	client     *http.Client
	config     config
	hostname   string
	cpuSampler *cpuSampler
}

type cpuSample struct {
	total uint64
	idle  uint64
}

type cpuSampler struct {
	previous *cpuSample
}

type heartbeatPayload struct {
	ServerID     string                 `json:"serverId"`
	AgentVersion string                 `json:"agentVersion"`
	ReportedAt   string                 `json:"reportedAt"`
	Items        []heartbeatPayloadItem `json:"items"`
}

type heartbeatPayloadItem struct {
	TargetType string `json:"targetType"`
	TargetID   string `json:"targetId"`
	Status     string `json:"status"`
	Reason     string `json:"reason"`
	ObservedAt string `json:"observedAt"`
}

type metricsPayload struct {
	ServerID   string               `json:"serverId"`
	ReportedAt string               `json:"reportedAt"`
	Items      []metricsPayloadItem `json:"items"`
}

type metricsPayloadItem struct {
	TargetType string            `json:"targetType"`
	TargetID   string            `json:"targetId"`
	Series     string            `json:"series"`
	Value      float64           `json:"value"`
	Unit       string            `json:"unit"`
	Labels     map[string]string `json:"labels,omitempty"`
	ObservedAt string            `json:"observedAt"`
}

type runtimeStatusPayload struct {
	ServerID   string                     `json:"serverId"`
	ReportedAt string                     `json:"reportedAt"`
	Items      []runtimeStatusPayloadItem `json:"items"`
}

type factsPayload struct {
	ServerID   string             `json:"serverId"`
	ReportedAt string             `json:"reportedAt"`
	Items      []factsPayloadItem `json:"items"`
}

type factsPayloadItem struct {
	TargetType string         `json:"targetType"`
	TargetID   string         `json:"targetId"`
	Facts      map[string]any `json:"facts"`
	ObservedAt string         `json:"observedAt"`
}

type runtimeStatusPayloadItem struct {
	TargetType   string                `json:"targetType"`
	TargetID     string                `json:"targetId"`
	RuntimeState string                `json:"runtimeState"`
	ObservedAt   string                `json:"observedAt"`
	Containers   runtimeContainerState `json:"containers"`
	Apps         []runtimeAppState     `json:"apps"`
}

type runtimeContainerState struct {
	Running    int `json:"running"`
	Restarting int `json:"restarting"`
	Exited     int `json:"exited"`
}

type runtimeAppState struct {
	AppID        string `json:"appId"`
	RuntimeState string `json:"runtimeState"`
}

func main() {
	configPath := flag.String("config", defaultConfigPath, "path to config yaml")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println(version)
		return
	}

	cfg, err := loadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}

	hostname, err := os.Hostname()
	if err != nil || strings.TrimSpace(hostname) == "" {
		hostname = "unknown"
	}

	agent := &agent{
		client:     &http.Client{Timeout: cfg.timeout()},
		config:     cfg,
		hostname:   hostname,
		cpuSampler: &cpuSampler{},
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := agent.run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}

func loadConfig(filePath string) (config, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return config{}, fmt.Errorf("load config: %w", err)
	}
	var cfg config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return config{}, fmt.Errorf("parse config: %w", err)
	}
	if strings.TrimSpace(cfg.ServerID) == "" {
		return config{}, fmt.Errorf("config server_id is required")
	}
	if strings.TrimSpace(cfg.IngestBaseURL) == "" {
		return config{}, fmt.Errorf("config ingest_base_url is required")
	}
	if strings.TrimSpace(cfg.Token) == "" {
		return config{}, fmt.Errorf("config token is required")
	}
	if cfg.Interval.Duration <= 0 {
		cfg.Interval.Duration = defaultInterval
	}
	if cfg.Timeout.Duration <= 0 {
		cfg.Timeout.Duration = defaultRequestTimeout
	}
	cfg.IngestBaseURL = strings.TrimRight(strings.TrimSpace(cfg.IngestBaseURL), "/")
	return cfg, nil
}

func (c config) interval() time.Duration {
	if c.Interval.Duration > 0 {
		return c.Interval.Duration
	}
	return defaultInterval
}

func (c config) timeout() time.Duration {
	if c.Timeout.Duration > 0 {
		return c.Timeout.Duration
	}
	return defaultRequestTimeout
}

func (a *agent) run(ctx context.Context) error {
	if err := a.runCycle(ctx); err != nil {
		log.Printf("monitor cycle failed: %v", err)
	} else {
		log.Printf("monitor cycle completed")
	}

	ticker := time.NewTicker(a.config.interval())
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := a.runCycle(ctx); err != nil {
				log.Printf("monitor cycle failed: %v", err)
			} else {
				log.Printf("monitor cycle completed")
			}
		}
	}
}

func (a *agent) runCycle(ctx context.Context) error {
	now := time.Now().UTC()
	runtimeState, runtimeErr := collectRuntimeSnapshot(ctx)
	if runtimeErr != nil {
		log.Printf("runtime snapshot degraded: %v", runtimeErr)
	}
	facts, factsErr := a.collectFacts(ctx, now)
	if factsErr != nil {
		log.Printf("facts collection degraded: %v", factsErr)
	}
	metrics, metricErr := a.collectMetrics(ctx, now)
	if metricErr != nil {
		return metricErr
	}
	if err := a.sendHeartbeat(ctx, now); err != nil {
		return err
	}
	if err := a.sendMetrics(ctx, now, metrics); err != nil {
		return err
	}
	if err := a.sendRuntimeStatus(ctx, now, runtimeState); err != nil {
		return err
	}
	if len(facts) > 0 {
		if err := a.sendFacts(ctx, now, facts); err != nil {
			log.Printf("facts upload degraded: %v", err)
		}
	}
	return nil
}

func (a *agent) collectMetrics(ctx context.Context, observedAt time.Time) ([]metricsPayloadItem, error) {
	cpuPercent, err := a.cpuSampler.Percent(ctx)
	if err != nil {
		return nil, err
	}
	memoryBytes, err := readMemoryUsedBytes()
	if err != nil {
		return nil, err
	}
	labels := map[string]string{"hostname": a.hostname}
	observedAtRaw := observedAt.Format(time.RFC3339)
	return []metricsPayloadItem{
		{
			TargetType: serverTargetType,
			TargetID:   a.config.ServerID,
			Series:     hostCPUMetric,
			Value:      cpuPercent,
			Unit:       "percent",
			Labels:     labels,
			ObservedAt: observedAtRaw,
		},
		{
			TargetType: serverTargetType,
			TargetID:   a.config.ServerID,
			Series:     hostMemoryMetric,
			Value:      float64(memoryBytes),
			Unit:       "bytes",
			Labels:     labels,
			ObservedAt: observedAtRaw,
		},
	}, nil
}

func (a *agent) sendHeartbeat(ctx context.Context, observedAt time.Time) error {
	payload := heartbeatPayload{
		ServerID:     a.config.ServerID,
		AgentVersion: version,
		ReportedAt:   observedAt.Format(time.RFC3339),
		Items: []heartbeatPayloadItem{{
			TargetType: serverTargetType,
			TargetID:   a.config.ServerID,
			Status:     statusHealthy,
			Reason:     "",
			ObservedAt: observedAt.Format(time.RFC3339),
		}},
	}
	return a.postJSON(ctx, "/heartbeat", payload)
}

func (a *agent) sendMetrics(ctx context.Context, observedAt time.Time, items []metricsPayloadItem) error {
	payload := metricsPayload{
		ServerID:   a.config.ServerID,
		ReportedAt: observedAt.Format(time.RFC3339),
		Items:      items,
	}
	return a.postJSON(ctx, "/metrics", payload)
}

func (a *agent) sendRuntimeStatus(ctx context.Context, observedAt time.Time, state runtimeContainerState) error {
	payload := runtimeStatusPayload{
		ServerID:   a.config.ServerID,
		ReportedAt: observedAt.Format(time.RFC3339),
		Items: []runtimeStatusPayloadItem{{
			TargetType:   serverTargetType,
			TargetID:     a.config.ServerID,
			RuntimeState: runtimeStateRunning,
			ObservedAt:   observedAt.Format(time.RFC3339),
			Containers:   state,
			Apps:         []runtimeAppState{},
		}},
	}
	return a.postJSON(ctx, "/runtime-status", payload)
}

func (a *agent) collectFacts(ctx context.Context, observedAt time.Time) (map[string]any, error) {
	_ = observedAt
	facts := map[string]any{
		"architecture": runtime.GOARCH,
		"cpu": map[string]any{
			"cores": runtime.NumCPU(),
		},
	}
	if osFacts := readOSReleaseFacts(); len(osFacts) > 0 {
		facts["os"] = osFacts
	}
	if kernelRelease := readKernelRelease(ctx); kernelRelease != "" {
		facts["kernel"] = map[string]any{"release": kernelRelease}
	}
	if totalBytes, err := readMemoryTotalBytes(); err == nil && totalBytes > 0 {
		facts["memory"] = map[string]any{"total_bytes": totalBytes}
	}
	if len(facts) == 0 {
		return nil, fmt.Errorf("no facts available")
	}
	return facts, nil
}

func (a *agent) sendFacts(ctx context.Context, observedAt time.Time, facts map[string]any) error {
	payload := factsPayload{
		ServerID:   a.config.ServerID,
		ReportedAt: observedAt.Format(time.RFC3339),
		Items: []factsPayloadItem{{
			TargetType: serverTargetType,
			TargetID:   a.config.ServerID,
			Facts:      facts,
			ObservedAt: observedAt.Format(time.RFC3339),
		}},
	}
	return a.postJSON(ctx, "/facts", payload)
}

func (a *agent) postJSON(ctx context.Context, suffix string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.config.IngestBaseURL+suffix, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+a.config.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("%s failed with status %d: %s", suffix, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func readMemoryUsedBytes() (uint64, error) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, err
	}
	var totalKB uint64
	var availableKB uint64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch strings.TrimSuffix(fields[0], ":") {
		case "MemTotal":
			totalKB = value
		case "MemAvailable":
			availableKB = value
		}
	}
	if totalKB == 0 {
		return 0, fmt.Errorf("meminfo missing MemTotal")
	}
	if availableKB > totalKB {
		availableKB = 0
	}
	return (totalKB - availableKB) * 1024, nil
}

func readMemoryTotalBytes() (uint64, error) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 || strings.TrimSuffix(fields[0], ":") != "MemTotal" {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0, err
		}
		return value * 1024, nil
	}
	return 0, fmt.Errorf("meminfo missing MemTotal")
}

func readOSReleaseFacts() map[string]any {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return nil
	}
	values := make(map[string]string)
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, raw, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		values[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(raw), `"`)
	}
	result := map[string]any{}
	if value := strings.ToLower(strings.TrimSpace(values["ID_LIKE"])); value != "" {
		parts := strings.Fields(value)
		if len(parts) > 0 {
			result["family"] = parts[0]
		}
	}
	if result["family"] == nil {
		if value := strings.ToLower(strings.TrimSpace(values["ID"])); value != "" {
			result["family"] = value
		}
	}
	if value := strings.TrimSpace(values["ID"]); value != "" {
		result["distribution"] = strings.ToLower(value)
	}
	if value := strings.TrimSpace(values["VERSION_ID"]); value != "" {
		result["version"] = value
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func readKernelRelease(ctx context.Context) string {
	commandCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	output, err := exec.CommandContext(commandCtx, "uname", "-r").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func (s *cpuSampler) Percent(ctx context.Context) (float64, error) {
	if s.previous == nil {
		sample, err := readCPUSample()
		if err != nil {
			return 0, err
		}
		s.previous = sample
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-time.After(initialCPUWarmupInterval):
		}
	}
	current, err := readCPUSample()
	if err != nil {
		return 0, err
	}
	previous := s.previous
	s.previous = current
	if previous == nil {
		return 0, nil
	}
	totalDelta := current.total - previous.total
	idleDelta := current.idle - previous.idle
	if totalDelta == 0 {
		return 0, nil
	}
	used := float64(totalDelta-idleDelta) / float64(totalDelta) * 100
	if used < 0 {
		return 0, nil
	}
	if used > 100 {
		return 100, nil
	}
	return used, nil
}

func readCPUSample() (*cpuSample, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return nil, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		var total uint64
		values := make([]uint64, 0, len(fields)-1)
		for _, field := range fields[1:] {
			value, err := strconv.ParseUint(field, 10, 64)
			if err != nil {
				return nil, err
			}
			values = append(values, value)
			total += value
		}
		if len(values) < 4 {
			return nil, fmt.Errorf("cpu stat missing idle column")
		}
		idle := values[3]
		if len(values) > 4 {
			idle += values[4]
		}
		return &cpuSample{total: total, idle: idle}, nil
	}
	return nil, fmt.Errorf("cpu stats not found")
}

func collectRuntimeSnapshot(ctx context.Context) (runtimeContainerState, error) {
	commandCtx, cancel := context.WithTimeout(ctx, dockerCommandTimeout)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, "docker", "ps", "-a", "--format", "{{.State}}")
	output, err := cmd.Output()
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			return runtimeContainerState{}, fmt.Errorf("docker ps failed: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return runtimeContainerState{}, err
	}
	state := runtimeContainerState{}
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		switch strings.TrimSpace(line) {
		case "running":
			state.Running++
		case "restarting":
			state.Restarting++
		case "", "created":
		default:
			state.Exited++
		}
	}
	return state, nil
}
