package service

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestNormalizePowerAction(t *testing.T) {
	action, err := NormalizePowerAction(" Restart ")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if action != "restart" {
		t.Fatalf("expected restart, got %q", action)
	}
	if _, err := NormalizePowerAction("reboot-now"); !errors.Is(err, ErrInvalidPowerAction) {
		t.Fatalf("expected invalid action error, got %v", err)
	}
}

func TestPowerCommand(t *testing.T) {
	command, err := PowerCommand("shutdown", 0)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if command != "(sudo -n systemctl poweroff || sudo -n shutdown -h now || systemctl poweroff || shutdown -h now)" {
		t.Fatalf("unexpected command: %q", command)
	}

	command, err = PowerCommand("shutdown", 5)
	if err != nil {
		t.Fatalf("expected no error for delayed shutdown, got %v", err)
	}
	if command != "(sudo -n shutdown -h +5 || shutdown -h +5)" {
		t.Fatalf("unexpected command for delayed shutdown: %q", command)
	}

	if _, err := PowerCommand("restart", 3); !errors.Is(err, ErrDelayNotSupported) {
		t.Fatalf("expected ErrDelayNotSupported for restart with delay, got %v", err)
	}

	if _, err := PowerCommand("shutdown", -1); !errors.Is(err, ErrDelayOutOfRange) {
		t.Fatalf("expected ErrDelayOutOfRange for negative delay, got %v", err)
	}

	if _, err := PowerCommand("shutdown", 1441); !errors.Is(err, ErrDelayOutOfRange) {
		t.Fatalf("expected ErrDelayOutOfRange for delay over 1440, got %v", err)
	}
}

func TestIsExpectedPowerDisconnect(t *testing.T) {
	if !IsExpectedPowerDisconnect(errors.New("write tcp: broken pipe")) {
		t.Fatal("expected broken pipe to be treated as expected disconnect")
	}
	if IsExpectedPowerDisconnect(errors.New("permission denied")) {
		t.Fatal("did not expect permission denied to be treated as expected disconnect")
	}
}

func TestPowerRuntimeServiceExecuteRestart(t *testing.T) {
	service := PowerRuntimeService{
		Run: func(_ context.Context, command string, timeout time.Duration) (string, error) {
			if command != "(sudo -n systemctl reboot || sudo -n reboot || systemctl reboot || reboot)" {
				t.Fatalf("unexpected command: %q", command)
			}
			if timeout != 20*time.Second {
				t.Fatalf("unexpected timeout: %v", timeout)
			}
			return "accepted", nil
		},
	}

	result, err := service.Execute(context.Background(), "restart", 0)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if result.Action != "restart" || result.Status != "accepted" || result.Output != "accepted" || result.ExpectedDisconnect {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestPowerRuntimeServiceExecuteExpectedDisconnect(t *testing.T) {
	service := PowerRuntimeService{
		Run: func(_ context.Context, _ string, _ time.Duration) (string, error) {
			return "", errors.New("connection reset by peer")
		},
	}

	result, err := service.Execute(context.Background(), "restart", 0)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if !result.ExpectedDisconnect {
		t.Fatalf("expected expected_disconnect result, got %#v", result)
	}
}

func TestPowerRuntimeServiceExecutePropagatesRunnerError(t *testing.T) {
	wantErr := errors.New("permission denied")
	service := PowerRuntimeService{
		Run: func(_ context.Context, _ string, _ time.Duration) (string, error) {
			return "stderr", wantErr
		},
	}

	result, err := service.Execute(context.Background(), "shutdown", 0)
	if !errors.Is(err, wantErr) {
		t.Fatalf("expected propagated error %v, got %v", wantErr, err)
	}
	if result.Output != "stderr" {
		t.Fatalf("expected output to be preserved, got %#v", result)
	}
}
