package monitor

import (
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
)

const (
	SettingsModule                     = "monitor"
	SchedulingSettingsKey              = "scheduling"
	PolicySettingsKey                  = "policy"
	PlatformSelfObservationSettingsKey = "platform-self-observation"
	ManagedCollectorPolicySettingsKey  = "managed-collector-policy"
	ReachabilityIntervalMinMinutes     = 60
	ReachabilityIntervalMaxMinutes     = 1440
	ReachabilityIntervalStepMinutes    = 60
)

type SchedulingSettings struct {
	ReachabilityIntervalMinutes        int
	MetricsFreshnessIntervalMinutes    int
	ControlReachabilityIntervalMinutes int
	RuntimeSnapshotIntervalMinutes     int
	CredentialSweepIntervalMinutes     int
	AppHealthIntervalMinutes           int
	FactsPullIntervalMinutes           int
}

type PolicySettings struct {
	ReachabilityProbeTimeout time.Duration
	MetricsFreshnessLookback time.Duration
	MetricsStaleThreshold    time.Duration
	MetricsMissingThreshold  time.Duration
	ControlProbeTimeout      time.Duration
	FactsPullTimeout         time.Duration
	RuntimePullTimeout       time.Duration
	FactsPullConcurrency     int
	RuntimePullConcurrency   int
}

type PlatformSelfObservationSettings struct {
	PlatformObserverInterval time.Duration
	SchedulerStaleThreshold  time.Duration
	EnableHostTelemetry      bool
	EnableContainerTelemetry bool
}

type ManagedCollectorPolicySettings struct {
	CollectionInterval time.Duration
	FlushInterval      time.Duration
	MetricBatchSize    int
	MetricBufferLimit  int
	CollectionJitter   time.Duration
	FlushJitter        time.Duration
}

func DefaultSchedulingSettings() SchedulingSettings {
	return SchedulingSettings{
		ReachabilityIntervalMinutes:        60,
		MetricsFreshnessIntervalMinutes:    1,
		ControlReachabilityIntervalMinutes: 1,
		RuntimeSnapshotIntervalMinutes:     1,
		CredentialSweepIntervalMinutes:     5,
		AppHealthIntervalMinutes:           1,
		FactsPullIntervalMinutes:           15,
	}
}

func NormalizeReachabilityIntervalMinutes(value int) int {
	if value < ReachabilityIntervalMinMinutes {
		return ReachabilityIntervalMinMinutes
	}
	if value > ReachabilityIntervalMaxMinutes {
		value = ReachabilityIntervalMaxMinutes
	}
	if remainder := value % ReachabilityIntervalStepMinutes; remainder != 0 {
		value += ReachabilityIntervalStepMinutes - remainder
		if value > ReachabilityIntervalMaxMinutes {
			value = ReachabilityIntervalMaxMinutes
		}
	}
	return value
}

func NormalizeSchedulingMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	value["reachabilityIntervalMinutes"] = NormalizeReachabilityIntervalMinutes(
		sysconfig.Int(value, "reachabilityIntervalMinutes", DefaultSchedulingSettings().ReachabilityIntervalMinutes),
	)
	return value
}

func DefaultPolicySettings() PolicySettings {
	return PolicySettings{
		ReachabilityProbeTimeout: 1500 * time.Millisecond,
		MetricsFreshnessLookback: 5 * time.Minute,
		MetricsStaleThreshold:    90 * time.Second,
		MetricsMissingThreshold:  180 * time.Second,
		ControlProbeTimeout:      5 * time.Second,
		FactsPullTimeout:         20 * time.Second,
		RuntimePullTimeout:       20 * time.Second,
		FactsPullConcurrency:     5,
		RuntimePullConcurrency:   5,
	}
}

func DefaultPlatformSelfObservationSettings() PlatformSelfObservationSettings {
	return PlatformSelfObservationSettings{
		PlatformObserverInterval: 30 * time.Second,
		SchedulerStaleThreshold:  10 * time.Second,
		EnableHostTelemetry:      false,
		EnableContainerTelemetry: false,
	}
}

func DefaultManagedCollectorPolicySettings() ManagedCollectorPolicySettings {
	return ManagedCollectorPolicySettings{
		CollectionInterval: 10 * time.Second,
		FlushInterval:      10 * time.Second,
		MetricBatchSize:    1000,
		MetricBufferLimit:  5000,
		CollectionJitter:   1 * time.Second,
		FlushJitter:        1 * time.Second,
	}
}

func LoadSchedulingSettings(app core.App) SchedulingSettings {
	defaults := DefaultSchedulingSettings()
	group, _ := sysconfig.GetGroup(app, SettingsModule, SchedulingSettingsKey, settingsschema.DefaultGroup(SettingsModule, SchedulingSettingsKey))
	settings := SchedulingSettings{
		ReachabilityIntervalMinutes:        NormalizeReachabilityIntervalMinutes(sysconfig.Int(group, "reachabilityIntervalMinutes", defaults.ReachabilityIntervalMinutes)),
		MetricsFreshnessIntervalMinutes:    clampMinimum(sysconfig.Int(group, "metricsFreshnessIntervalMinutes", defaults.MetricsFreshnessIntervalMinutes), 1, defaults.MetricsFreshnessIntervalMinutes),
		ControlReachabilityIntervalMinutes: clampMinimum(sysconfig.Int(group, "controlReachabilityIntervalMinutes", defaults.ControlReachabilityIntervalMinutes), 1, defaults.ControlReachabilityIntervalMinutes),
		RuntimeSnapshotIntervalMinutes:     clampMinimum(sysconfig.Int(group, "runtimeSnapshotIntervalMinutes", defaults.RuntimeSnapshotIntervalMinutes), 1, defaults.RuntimeSnapshotIntervalMinutes),
		CredentialSweepIntervalMinutes:     clampMinimum(sysconfig.Int(group, "credentialSweepIntervalMinutes", defaults.CredentialSweepIntervalMinutes), 1, defaults.CredentialSweepIntervalMinutes),
		AppHealthIntervalMinutes:           clampMinimum(sysconfig.Int(group, "appHealthIntervalMinutes", defaults.AppHealthIntervalMinutes), 1, defaults.AppHealthIntervalMinutes),
		FactsPullIntervalMinutes:           clampMinimum(sysconfig.Int(group, "factsPullIntervalMinutes", defaults.FactsPullIntervalMinutes), 1, defaults.FactsPullIntervalMinutes),
	}
	return settings
}

func LoadPolicySettings(app core.App) PolicySettings {
	defaults := DefaultPolicySettings()
	group, _ := sysconfig.GetGroup(app, SettingsModule, PolicySettingsKey, settingsschema.DefaultGroup(SettingsModule, PolicySettingsKey))
	settings := PolicySettings{
		ReachabilityProbeTimeout: time.Duration(clampRange(sysconfig.Int(group, "reachabilityProbeTimeoutMs", int(defaults.ReachabilityProbeTimeout/time.Millisecond)), 100, 300000, int(defaults.ReachabilityProbeTimeout/time.Millisecond))) * time.Millisecond,
		MetricsFreshnessLookback: time.Duration(clampMinimum(sysconfig.Int(group, "metricsFreshnessLookbackSeconds", int(defaults.MetricsFreshnessLookback/time.Second)), 1, int(defaults.MetricsFreshnessLookback/time.Second))) * time.Second,
		MetricsStaleThreshold:    time.Duration(clampRange(sysconfig.Int(group, "metricsStaleSeconds", int(defaults.MetricsStaleThreshold/time.Second)), 30, 300, int(defaults.MetricsStaleThreshold/time.Second))) * time.Second,
		MetricsMissingThreshold:  time.Duration(clampRange(sysconfig.Int(group, "metricsMissingSeconds", int(defaults.MetricsMissingThreshold/time.Second)), 31, 600, int(defaults.MetricsMissingThreshold/time.Second))) * time.Second,
		ControlProbeTimeout:      time.Duration(clampRange(sysconfig.Int(group, "controlProbeTimeoutSeconds", int(defaults.ControlProbeTimeout/time.Second)), 1, 300, int(defaults.ControlProbeTimeout/time.Second))) * time.Second,
		FactsPullTimeout:         time.Duration(clampRange(sysconfig.Int(group, "factsPullTimeoutSeconds", int(defaults.FactsPullTimeout/time.Second)), 1, 300, int(defaults.FactsPullTimeout/time.Second))) * time.Second,
		RuntimePullTimeout:       time.Duration(clampRange(sysconfig.Int(group, "runtimePullTimeoutSeconds", int(defaults.RuntimePullTimeout/time.Second)), 1, 300, int(defaults.RuntimePullTimeout/time.Second))) * time.Second,
		FactsPullConcurrency:     clampRange(sysconfig.Int(group, "factsPullConcurrency", defaults.FactsPullConcurrency), 1, 50, defaults.FactsPullConcurrency),
		RuntimePullConcurrency:   clampRange(sysconfig.Int(group, "runtimePullConcurrency", defaults.RuntimePullConcurrency), 1, 50, defaults.RuntimePullConcurrency),
	}
	if settings.MetricsMissingThreshold <= settings.MetricsStaleThreshold {
		settings.MetricsMissingThreshold = defaults.MetricsMissingThreshold
	}
	if settings.MetricsFreshnessLookback < settings.MetricsMissingThreshold {
		settings.MetricsFreshnessLookback = settings.MetricsMissingThreshold
	}
	return settings
}

func LoadPlatformSelfObservationSettings(app core.App) PlatformSelfObservationSettings {
	defaults := DefaultPlatformSelfObservationSettings()
	group, _ := sysconfig.GetGroup(app, SettingsModule, PlatformSelfObservationSettingsKey, settingsschema.DefaultGroup(SettingsModule, PlatformSelfObservationSettingsKey))
	return PlatformSelfObservationSettings{
		PlatformObserverInterval: time.Duration(clampRange(sysconfig.Int(group, "platformObserverIntervalSeconds", int(defaults.PlatformObserverInterval/time.Second)), 5, 300, int(defaults.PlatformObserverInterval/time.Second))) * time.Second,
		SchedulerStaleThreshold:  time.Duration(clampRange(sysconfig.Int(group, "platformSchedulerStaleThresholdSeconds", int(defaults.SchedulerStaleThreshold/time.Second)), 5, 300, int(defaults.SchedulerStaleThreshold/time.Second))) * time.Second,
		EnableHostTelemetry:      groupBool(group, "enableHostTelemetry", defaults.EnableHostTelemetry),
		EnableContainerTelemetry: groupBool(group, "enableContainerTelemetry", defaults.EnableContainerTelemetry),
	}
}

func LoadPlatformSelfObservationRuntimeSettings(app core.App, hostTelemetryFallback, containerTelemetryFallback bool) PlatformSelfObservationSettings {
	settings := LoadPlatformSelfObservationSettings(app)
	if _, err := sysconfig.GetGroup(app, SettingsModule, PlatformSelfObservationSettingsKey, settingsschema.DefaultGroup(SettingsModule, PlatformSelfObservationSettingsKey)); err != nil {
		settings.EnableHostTelemetry = hostTelemetryFallback
		settings.EnableContainerTelemetry = containerTelemetryFallback
	}
	return settings
}

func LoadManagedCollectorPolicySettings(app core.App) ManagedCollectorPolicySettings {
	defaults := DefaultManagedCollectorPolicySettings()
	group, _ := sysconfig.GetGroup(app, SettingsModule, ManagedCollectorPolicySettingsKey, settingsschema.DefaultGroup(SettingsModule, ManagedCollectorPolicySettingsKey))
	settings := ManagedCollectorPolicySettings{
		CollectionInterval: time.Duration(clampRange(sysconfig.Int(group, "collectionIntervalSeconds", int(defaults.CollectionInterval/time.Second)), 5, 300, int(defaults.CollectionInterval/time.Second))) * time.Second,
		FlushInterval:      time.Duration(clampRange(sysconfig.Int(group, "flushIntervalSeconds", int(defaults.FlushInterval/time.Second)), 5, 300, int(defaults.FlushInterval/time.Second))) * time.Second,
		MetricBatchSize:    clampRange(sysconfig.Int(group, "metricBatchSize", defaults.MetricBatchSize), 1, 10000, defaults.MetricBatchSize),
		MetricBufferLimit:  clampRange(sysconfig.Int(group, "metricBufferLimit", defaults.MetricBufferLimit), 1, 50000, defaults.MetricBufferLimit),
		CollectionJitter:   time.Duration(clampRange(sysconfig.Int(group, "collectionJitterSeconds", int(defaults.CollectionJitter/time.Second)), 0, 300, int(defaults.CollectionJitter/time.Second))) * time.Second,
		FlushJitter:        time.Duration(clampRange(sysconfig.Int(group, "flushJitterSeconds", int(defaults.FlushJitter/time.Second)), 0, 300, int(defaults.FlushJitter/time.Second))) * time.Second,
	}
	if settings.MetricBufferLimit < settings.MetricBatchSize {
		settings.MetricBufferLimit = defaults.MetricBufferLimit
	}
	if settings.CollectionJitter > settings.CollectionInterval {
		settings.CollectionJitter = defaults.CollectionJitter
	}
	if settings.FlushJitter > settings.FlushInterval {
		settings.FlushJitter = defaults.FlushJitter
	}
	return settings
}

func groupBool(group map[string]any, field string, fallback bool) bool {
	v, ok := group[field]
	if !ok || v == nil {
		return fallback
	}
	switch value := v.(type) {
	case bool:
		return value
	case string:
		switch value {
		case "true", "1", "yes", "on":
			return true
		case "false", "0", "no", "off":
			return false
		}
	}
	return fallback
}

func clampMinimum(value, minimum, fallback int) int {
	if value < minimum {
		return fallback
	}
	return value
}

func clampRange(value, minimum, maximum, fallback int) int {
	if value < minimum || value > maximum {
		return fallback
	}
	return value
}
