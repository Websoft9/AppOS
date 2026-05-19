package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

type PowerCommandRunner func(context.Context, string, time.Duration) (string, error)

type PowerRuntimeService struct {
	Run PowerCommandRunner
}

type PowerActionResult struct {
	Action             string `json:"action"`
	Status             string `json:"status"`
	Output             string `json:"output"`
	ExpectedDisconnect bool   `json:"expected_disconnect"`
}

var ErrInvalidPowerAction = errors.New("action must be restart or shutdown")

func NormalizePowerAction(raw string) (string, error) {
	action := strings.ToLower(strings.TrimSpace(raw))
	switch action {
	case "restart", "shutdown":
		return action, nil
	default:
		return "", ErrInvalidPowerAction
	}
}

func PowerCommand(action string) (string, error) {
	normalized, err := NormalizePowerAction(action)
	if err != nil {
		return "", err
	}
	switch normalized {
	case "restart":
		return "(sudo -n systemctl reboot || sudo -n reboot || systemctl reboot || reboot)", nil
	case "shutdown":
		return "(sudo -n systemctl poweroff || sudo -n shutdown -h now || systemctl poweroff || shutdown -h now)", nil
	default:
		return "", ErrInvalidPowerAction
	}
}

func IsExpectedPowerDisconnect(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "connection reset") ||
		strings.Contains(message, "broken pipe") ||
		strings.Contains(message, "use of closed network connection") ||
		strings.Contains(message, "unexpected eof")
}

func (s PowerRuntimeService) Execute(ctx context.Context, action string) (PowerActionResult, error) {
	command, err := PowerCommand(action)
	if err != nil {
		return PowerActionResult{}, err
	}
	output, runErr := s.run(ctx, command, 20*time.Second)
	result := PowerActionResult{
		Action: action,
		Status: "accepted",
		Output: output,
	}
	if runErr == nil {
		return result, nil
	}
	if IsExpectedPowerDisconnect(runErr) {
		result.ExpectedDisconnect = true
		return result, nil
	}
	return result, runErr
}

func (s PowerRuntimeService) run(ctx context.Context, command string, timeout time.Duration) (string, error) {
	if s.Run == nil {
		return "", fmt.Errorf("power command runner is required")
	}
	return s.Run(ctx, command, timeout)
}