package deploy

import "testing"

func TestValidateManualCompose(t *testing.T) {
	valid := "services:\n  web:\n    image: nginx:alpine\n"
	if err := ValidateManualCompose(valid); err != nil {
		t.Fatalf("expected valid compose, got error: %v", err)
	}

	invalid := "version: '3'\nnetworks:\n  default: {}\n"
	if err := ValidateManualCompose(invalid); err == nil {
		t.Fatal("expected missing services error")
	}
}

func TestCanTransition(t *testing.T) {
	if !CanTransition(StatusQueued, StatusValidating) {
		t.Fatal("expected queued -> validating to be allowed")
	}
	if CanTransition(StatusQueued, StatusSuccess) {
		t.Fatal("expected queued -> success to be rejected")
	}
	if !CanTransition(StatusRunning, StatusVerifying) {
		t.Fatal("expected running -> verifying to be allowed")
	}
}

func TestApplyEvent(t *testing.T) {
	next, err := ApplyEvent("", EventCreate)
	if err != nil || next != StatusQueued {
		t.Fatalf("expected create -> queued, got %q err=%v", next, err)
	}
	next, err = ApplyEvent(StatusPreparing, EventExecutionStarted)
	if err != nil || next != StatusRunning {
		t.Fatalf("expected preparing + execution_started -> running, got %q err=%v", next, err)
	}
	if _, err := ApplyEvent(StatusQueued, EventDeploymentSucceeded); err == nil {
		t.Fatal("expected illegal queued -> success event to fail")
	}
	next, err = ApplyEvent(StatusVerifying, EventTimedOut)
	if err != nil || next != StatusTimeout {
		t.Fatalf("expected verifying + timed_out -> timeout, got %q err=%v", next, err)
	}
}

func TestFailureEventForStatus(t *testing.T) {
	event, err := FailureEventForStatus(StatusVerifying)
	if err != nil {
		t.Fatalf("expected failure event for verifying, got error: %v", err)
	}
	if event != EventVerificationFailed {
		t.Fatalf("expected verification_failed, got %q", event)
	}
}

func TestNormalizeProjectName(t *testing.T) {
	got := NormalizeProjectName("My Demo_App")
	if got != "my-demo-app" {
		t.Fatalf("expected normalized project name, got %q", got)
	}
}
