package platform

import "testing"

func TestNewPlatformObserverDisablesLocalTelemetryByDefault(t *testing.T) {
	t.Setenv(EnvPlatformEnableHostTelemetry, "")
	t.Setenv(EnvPlatformEnableContainerTelemetry, "")

	observer := NewPlatformObserver(nil, nil)
	if observer.hostTelemetryFn != nil {
		t.Fatal("expected host telemetry to be disabled by default")
	}
	if observer.containerStatsFn != nil {
		t.Fatal("expected container telemetry to be disabled by default")
	}
}

func TestNewPlatformObserverEnablesConfiguredLocalTelemetry(t *testing.T) {
	t.Setenv(EnvPlatformEnableHostTelemetry, "true")
	t.Setenv(EnvPlatformEnableContainerTelemetry, "1")

	observer := NewPlatformObserver(nil, nil)
	if observer.hostTelemetryFn == nil {
		t.Fatal("expected host telemetry to be enabled when configured")
	}
	if observer.containerStatsFn == nil {
		t.Fatal("expected container telemetry to be enabled when configured")
	}
}