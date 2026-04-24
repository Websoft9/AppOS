package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	monitorchecks "github.com/websoft9/appos/backend/domain/monitor/signals/checks"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

const TaskMonitorReachabilitySweep = "monitor:reachability_sweep"
const TaskMonitorHeartbeatFreshness = "monitor:heartbeat_freshness"
const TaskMonitorCredentialSweep = "monitor:credential_sweep"
const TaskMonitorAppHealthSweep = "monitor:app_health_sweep"

type MonitorReachabilitySweepPayload struct{}
type MonitorHeartbeatFreshnessPayload struct{}
type MonitorCredentialSweepPayload struct{}
type MonitorAppHealthSweepPayload struct{}

func NewMonitorReachabilitySweepTask() (*asynq.Task, error) {
	payload, err := json.Marshal(MonitorReachabilitySweepPayload{})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskMonitorReachabilitySweep, payload), nil
}

func EnqueueMonitorReachabilitySweep(client *asynq.Client) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewMonitorReachabilitySweepTask()
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

func NewMonitorHeartbeatFreshnessTask() (*asynq.Task, error) {
	payload, err := json.Marshal(MonitorHeartbeatFreshnessPayload{})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskMonitorHeartbeatFreshness, payload), nil
}

func NewMonitorCredentialSweepTask() (*asynq.Task, error) {
	payload, err := json.Marshal(MonitorCredentialSweepPayload{})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskMonitorCredentialSweep, payload), nil
}

func NewMonitorAppHealthSweepTask() (*asynq.Task, error) {
	payload, err := json.Marshal(MonitorAppHealthSweepPayload{})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskMonitorAppHealthSweep, payload), nil
}

func EnqueueMonitorHeartbeatFreshness(client *asynq.Client) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewMonitorHeartbeatFreshnessTask()
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

func EnqueueMonitorCredentialSweep(client *asynq.Client) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewMonitorCredentialSweepTask()
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

func EnqueueMonitorAppHealthSweep(client *asynq.Client) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewMonitorAppHealthSweepTask()
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

func (w *Worker) handleMonitorReachabilitySweep(_ context.Context, t *asynq.Task) error {
	if t != nil && len(t.Payload()) > 0 {
		var payload MonitorReachabilitySweepPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil && !strings.Contains(err.Error(), "EOF") {
			return err
		}
	}
	return monitorchecks.RunInstanceReachabilitySweep(w.app, persistence.NewInstanceRepository(w.app), time.Now().UTC())
}

func (w *Worker) handleMonitorHeartbeatFreshness(_ context.Context, t *asynq.Task) error {
	if t != nil && len(t.Payload()) > 0 {
		var payload MonitorHeartbeatFreshnessPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil && !strings.Contains(err.Error(), "EOF") {
			return err
		}
	}
	return monitorstatus.RefreshHeartbeatFreshness(w.app, time.Now().UTC())
}

func (w *Worker) handleMonitorCredentialSweep(_ context.Context, t *asynq.Task) error {
	if t != nil && len(t.Payload()) > 0 {
		var payload MonitorCredentialSweepPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil && !strings.Contains(err.Error(), "EOF") {
			return err
		}
	}
	return monitorchecks.RunInstanceCredentialSweep(w.app, persistence.NewInstanceRepository(w.app), time.Now().UTC())
}

func (w *Worker) handleMonitorAppHealthSweep(_ context.Context, t *asynq.Task) error {
	if t != nil && len(t.Payload()) > 0 {
		var payload MonitorAppHealthSweepPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil && !strings.Contains(err.Error(), "EOF") {
			return err
		}
	}
	return monitorchecks.RunAppHealthSweep(w.app, time.Now().UTC())
}
