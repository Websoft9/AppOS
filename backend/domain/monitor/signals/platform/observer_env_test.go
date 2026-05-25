package platform

import "testing"

func TestNewPlatformObserverDisablesLocalTelemetryByDefault(t *testing.T) {
	t.Setenv(EnvPlatformEnableHostTelemetry, "")
	t.Setenv(EnvPlatformEnableContainerTelemetry, "")

	observer := NewPlatformObserver(nil, nil)
	if observer.hostTelemetryFn == nil {
		t.Fatal("expected host telemetry collector to be available for runtime settings gating")
	}
	if observer.containerStatsFn == nil {
		t.Fatal("expected container telemetry collector to be available for runtime settings gating")
	}
}

func TestNewPlatformObserverEnablesConfiguredLocalTelemetry(t *testing.T) {
	t.Setenv(EnvPlatformEnableHostTelemetry, "true")
	t.Setenv(EnvPlatformEnableContainerTelemetry, "1")

	observer := NewPlatformObserver(nil, nil)
	if observer.hostTelemetryFn == nil {
		t.Fatal("expected host telemetry collector to be wired")
	}
	if observer.containerStatsFn == nil {
		t.Fatal("expected container telemetry collector to be wired")
	}
}