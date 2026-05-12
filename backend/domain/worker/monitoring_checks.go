package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	monitorchecks "github.com/websoft9/appos/backend/domain/monitor/signals/checks"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

const TaskMonitorReachabilitySweep = "monitor:reachability_sweep"
const TaskMonitorMetricsFreshness = "monitor:metrics_freshness"
const TaskMonitorControlReachability = "monitor:control_reachability"
const TaskMonitorFactsPull = "monitor:facts_pull"
const TaskMonitorRuntimeSnapshotPull = "monitor:runtime_snapshot_pull"
const TaskMonitorCredentialSweep = "monitor:credential_sweep"
const TaskMonitorAppHealthSweep = "monitor:app_health_sweep"

type MonitorReachabilitySweepPayload struct{}
type MonitorMetricsFreshnessPayload struct{}
type MonitorControlReachabilityPayload struct{}
type MonitorFactsPullPayload struct{}
type MonitorRuntimeSnapshotPullPayload struct{}
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

func NewMonitorMetricsFreshnessTask() (*asynq.Task, error) {
	payload, err := json.Marshal(MonitorMetricsFreshnessPayload{})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskMonitorMetricsFreshness, payload), nil
}

func NewMonitorControlReachabilityTask() (*asynq.Task, error) {
	payload, err := json.Marshal(MonitorControlReachabilityPayload{})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskMonitorControlReachability, payload), nil
}

func NewMonitorFactsPullTask() (*asynq.Task, error) {
	payload, err := json.Marshal(MonitorFactsPullPayload{})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskMonitorFactsPull, payload), nil
}

func NewMonitorRuntimeSnapshotPullTask() (*asynq.Task, error) {
	payload, err := json.Marshal(MonitorRuntimeSnapshotPullPayload{})
	if err != nil {
		return nil, err
	}
	return asynq.NewTask(TaskMonitorRuntimeSnapshotPull, payload), nil
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

func EnqueueMonitorMetricsFreshness(client *asynq.Client) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewMonitorMetricsFreshnessTask()
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

func EnqueueMonitorControlReachability(client *asynq.Client) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewMonitorControlReachabilityTask()
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

func EnqueueMonitorFactsPull(client *asynq.Client) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewMonitorFactsPullTask()
	if err != nil {
		return err
	}
	_, err = client.Enqueue(task, asynq.Queue("default"))
	return err
}

func EnqueueMonitorRuntimeSnapshotPull(client *asynq.Client) error {
	if client == nil {
		return fmt.Errorf("asynq client is not configured")
	}
	task, err := NewMonitorRuntimeSnapshotPullTask()
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

func (w *Worker) handleMonitorMetricsFreshness(_ context.Context, t *asynq.Task) error {
	if t != nil && len(t.Payload()) > 0 {
		var payload MonitorMetricsFreshnessPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil && !strings.Contains(err.Error(), "EOF") {
			return err
		}
	}
	return monitorchecks.RunServerMetricsFreshnessSweep(w.app, time.Now().UTC())
}

func (w *Worker) handleMonitorControlReachability(_ context.Context, t *asynq.Task) error {
	if t != nil && len(t.Payload()) > 0 {
		var payload MonitorControlReachabilityPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil && !strings.Contains(err.Error(), "EOF") {
			return err
		}
	}
	return monitorchecks.RunServerControlReachabilitySweep(w.app, time.Now().UTC())
}

func (w *Worker) handleMonitorFactsPull(_ context.Context, t *asynq.Task) error {
	if t != nil && len(t.Payload()) > 0 {
		var payload MonitorFactsPullPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil && !strings.Contains(err.Error(), "EOF") {
			return err
		}
	}
	return monitorchecks.RunServerFactsPullSweep(w.app, time.Now().UTC())
}

func (w *Worker) handleMonitorRuntimeSnapshotPull(_ context.Context, t *asynq.Task) error {
	if t != nil && len(t.Payload()) > 0 {
		var payload MonitorRuntimeSnapshotPullPayload
		if err := json.Unmarshal(t.Payload(), &payload); err != nil && !strings.Contains(err.Error(), "EOF") {
			return err
		}
	}
	return monitorchecks.RunServerRuntimeSnapshotPullSweep(w.app, time.Now().UTC())
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
