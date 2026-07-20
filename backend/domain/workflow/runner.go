package workflow

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

type Runner struct {
	repo Repository
}

type ExecutionContext struct {
	Run      *RunRecord
	Nodes    []NodeDefinition
	NodeRuns map[string]*NodeRunRecord
}

type RunResult struct {
	Status string
	Node   *NodeRunRecord
}

func IsTerminalRunStatus(status string) bool {
	for _, candidate := range TerminalRunStatuses {
		if candidate == strings.TrimSpace(status) {
			return true
		}
	}
	return false
}

func NewRunner(repo Repository) *Runner {
	return &Runner{repo: repo}
}

func (r *Runner) LoadExecutionContext(ctx context.Context, runID string, definitionYAML string) (*ExecutionContext, error) {
	run, err := r.repo.GetRun(ctx, runID)
	if err != nil {
		return nil, err
	}
	def, err := ParseDefinition(definitionYAML)
	if err != nil {
		return nil, err
	}
	nodeRuns, err := r.repo.ListNodeRunsByRun(ctx, runID)
	if err != nil {
		return nil, err
	}
	nodesByKey := make(map[string]*NodeRunRecord, len(nodeRuns))
	for _, nodeRun := range nodeRuns {
		nodesByKey[nodeRun.NodeKey] = nodeRun
	}
	return &ExecutionContext{Run: run, Nodes: def.Nodes, NodeRuns: nodesByKey}, nil
}

func ReadyNodes(execCtx *ExecutionContext) []NodeDefinition {
	if execCtx == nil {
		return nil
	}
	ready := make([]NodeDefinition, 0)
	for _, node := range execCtx.Nodes {
		nodeRun := execCtx.NodeRuns[node.Key]
		if nodeRun == nil || nodeRun.Status != NodeStatusPending {
			continue
		}
		if !nodeDependenciesSatisfied(execCtx, node) {
			continue
		}
		ready = append(ready, node)
	}
	sort.SliceStable(ready, func(i, j int) bool { return ready[i].Key < ready[j].Key })
	return ready
}

func nodeDependenciesSatisfied(execCtx *ExecutionContext, node NodeDefinition) bool {
	for _, dependency := range node.DependsOn {
		nodeRun := execCtx.NodeRuns[strings.TrimSpace(dependency)]
		if nodeRun == nil {
			return false
		}
		switch nodeRun.Status {
		case NodeStatusSucceeded, NodeStatusSkipped:
			continue
		default:
			return false
		}
	}
	return true
}

func MarkRunOrphaned(ctx context.Context, repo Repository, runID string) error {
	run, err := repo.GetRun(ctx, runID)
	if err != nil {
		return err
	}
	if run.Status != RunStatusRunning {
		return nil
	}
	failed := RunStatusFailed
	message := "workflow orphaned after worker restart"
	if _, err := repo.UpdateRun(ctx, runID, UpdateRunInput{Status: &failed, ErrorMessage: &message}); err != nil {
		return err
	}
	nodeRuns, err := repo.ListNodeRunsByRun(ctx, runID)
	if err != nil {
		return err
	}
	for _, nodeRun := range nodeRuns {
		if nodeRun.Status != NodeStatusRunning {
			continue
		}
		failedNode := NodeStatusFailed
		if _, err := repo.UpdateNodeRun(ctx, nodeRun.ID, UpdateNodeRunInput{Status: &failedNode, ErrorMessage: &message}); err != nil {
			return err
		}
	}
	return nil
}

func DecodeDependsOnJSON(encoded string) ([]string, error) {
	if strings.TrimSpace(encoded) == "" {
		return nil, nil
	}
	var values []string
	if err := json.Unmarshal([]byte(encoded), &values); err != nil {
		return nil, err
	}
	return values, nil
}

func EncodeOutputJSON(values map[string]any) string {
	data, err := json.Marshal(values)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func DecodeOutputJSON(encoded string) (map[string]any, error) {
	if strings.TrimSpace(encoded) == "" {
		return map[string]any{}, nil
	}
	var values map[string]any
	if err := json.Unmarshal([]byte(encoded), &values); err != nil {
		return nil, err
	}
	return values, nil
}

func (r *Runner) Run(ctx context.Context, execCtx *ExecutionContext, execute func(context.Context, *NodeRunRecord, NodeDefinition) (string, map[string]any, error)) (RunResult, error) {
	if execCtx == nil {
		return RunResult{}, fmt.Errorf("execution context is required")
	}
	for {
		currentRun, err := r.repo.GetRun(ctx, execCtx.Run.ID)
		if err != nil {
			return RunResult{}, err
		}
		execCtx.Run = currentRun
		if currentRun.Status == RunStatusCancelled {
			return RunResult{Status: RunStatusCancelled}, nil
		}
		ready := ReadyNodes(execCtx)
		if len(ready) == 0 {
			if allNodesTerminal(execCtx) {
				return RunResult{Status: RunStatusSucceeded}, nil
			}
			if waitingNode := terminalNodeByStatus(execCtx, NodeStatusWaiting); waitingNode != nil {
				return RunResult{Status: RunStatusWaiting, Node: waitingNode}, nil
			}
			if gateNode := terminalNodeByStatus(execCtx, NodeStatusManualGate); gateNode != nil {
				return RunResult{Status: RunStatusManualGate, Node: gateNode}, nil
			}
			return RunResult{}, fmt.Errorf("workflow stalled: no ready nodes remain")
		}
		type result struct {
			node       NodeDefinition
			nodeRun    *NodeRunRecord
			status     string
			outputJSON string
			err        error
		}
		results := make([]result, len(ready))
		for i, node := range ready {
			nodeRun := execCtx.NodeRuns[node.Key]
			status := NodeStatusRunning
			startedAt := nowRFC3339()
			updated, err := r.repo.UpdateNodeRun(ctx, nodeRun.ID, UpdateNodeRunInput{Status: &status, StartedAt: &startedAt})
			if err != nil {
				return RunResult{}, err
			}
			execCtx.NodeRuns[node.Key] = updated
			results[i] = result{node: node, nodeRun: updated}
		}
		var wg sync.WaitGroup
		for i := range results {
			wg.Add(1)
			go func(index int) {
				defer wg.Done()
				status, output, err := execute(ctx, results[index].nodeRun, results[index].node)
				results[index].status = status
				results[index].outputJSON = EncodeOutputJSON(output)
				results[index].err = err
			}(i)
		}
		wg.Wait()
		currentRun, err = r.repo.GetRun(ctx, execCtx.Run.ID)
		if err != nil {
			return RunResult{}, err
		}
		execCtx.Run = currentRun
		if currentRun.Status == RunStatusCancelled {
			for _, item := range results {
				cancelled := NodeStatusCancelled
				endedAt := nowRFC3339()
				updated, updateErr := r.repo.UpdateNodeRun(ctx, item.nodeRun.ID, UpdateNodeRunInput{Status: &cancelled, EndedAt: &endedAt})
				if updateErr != nil {
					return RunResult{}, updateErr
				}
				execCtx.NodeRuns[item.node.Key] = updated
			}
			return RunResult{Status: RunStatusCancelled}, nil
		}
		var pendingResult *RunResult
		for _, item := range results {
			endedAt := nowRFC3339()
			if item.err != nil {
				status := NodeStatusFailed
				message := item.err.Error()
				if _, updateErr := r.repo.UpdateNodeRun(ctx, item.nodeRun.ID, UpdateNodeRunInput{Status: &status, ErrorMessage: &message, OutputJSON: &item.outputJSON, EndedAt: &endedAt}); updateErr != nil {
					return RunResult{}, updateErr
				}
				failed := RunStatusFailed
				if _, updateErr := r.repo.UpdateRun(ctx, execCtx.Run.ID, UpdateRunInput{Status: &failed, ErrorMessage: &message, EndedAt: &endedAt}); updateErr != nil {
					return RunResult{}, updateErr
				}
				return RunResult{Status: RunStatusFailed, Node: item.nodeRun}, item.err
			}
			status := item.status
			updated, err := r.repo.UpdateNodeRun(ctx, item.nodeRun.ID, UpdateNodeRunInput{Status: &status, OutputJSON: &item.outputJSON, EndedAt: &endedAt})
			if err != nil {
				return RunResult{}, err
			}
			execCtx.NodeRuns[item.node.Key] = updated
			if status == NodeStatusManualGate {
				result := RunResult{Status: RunStatusManualGate, Node: updated}
				pendingResult = &result
			}
			if status == NodeStatusWaiting {
				result := RunResult{Status: RunStatusWaiting, Node: updated}
				pendingResult = &result
			}
		}
		if pendingResult != nil {
			return *pendingResult, nil
		}
	}
}

func allNodesTerminal(execCtx *ExecutionContext) bool {
	for _, nodeRun := range execCtx.NodeRuns {
		switch nodeRun.Status {
		case NodeStatusSucceeded, NodeStatusFailed, NodeStatusSkipped, NodeStatusCancelled, NodeStatusWaiting, NodeStatusManualGate:
			continue
		default:
			return false
		}
	}
	return true
}

func terminalNodeByStatus(execCtx *ExecutionContext, status string) *NodeRunRecord {
	for _, nodeRun := range execCtx.NodeRuns {
		if nodeRun.Status == status {
			return nodeRun
		}
	}
	return nil
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
