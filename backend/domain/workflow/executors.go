package workflow

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"text/template"
	"time"

	"github.com/domodwyer/mailyak/v3"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/ai/copilot"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	connectorsdomain "github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/domain/resource/servers"
	"github.com/websoft9/appos/backend/domain/runtimepaths"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/domain/terminal"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

var workflowExecuteSSHCommand = terminal.ExecuteSSHCommand
var workflowExecCommandContext = exec.CommandContext

// WorkflowExecuteSSHCommandForTesting allows tests in other packages to stub SSH execution.
var WorkflowExecuteSSHCommandForTesting = workflowExecuteSSHCommand

type ExecutorContext struct {
	App        core.App
	Definition *Definition
	Run        *RunRecord
	NodeRuns   map[string]*NodeRunRecord
	Params     map[string]any
	Repo       Repository
	Resolver   copilot.ProviderResolver
}

type Executor interface {
	Execute(ctx context.Context, execCtx *ExecutorContext, nodeRun *NodeRunRecord, node NodeDefinition) (string, map[string]any, error)
}

type ExecutorRegistry struct {
	executors map[string]Executor
}

func NewExecutorRegistry(app core.App) *ExecutorRegistry {
	registry := &ExecutorRegistry{executors: map[string]Executor{}}
	registry.Register(NodeTypeShell, shellExecutor{app: app})
	registry.Register(NodeTypeDocker, dockerExecutor{app: app})
	registry.Register(NodeTypeHTTP, httpExecutor{})
	registry.Register(NodeTypeSMTP, smtpExecutor{app: app})
	registry.Register(NodeTypeCondition, conditionExecutor{})
	registry.Register(NodeTypeManualGate, manualGateExecutor{})
	registry.Register(NodeTypeSubworkflow, subworkflowExecutor{})
	registry.Register(NodeTypeLLM, llmExecutor{app: app})
	registry.Register(NodeTypeAgent, agentExecutor{})
	return registry
}

func (r *ExecutorRegistry) Register(nodeType string, executor Executor) {
	if r == nil || executor == nil {
		return
	}
	r.executors[nodeType] = executor
}

func (r *ExecutorRegistry) Execute(ctx context.Context, execCtx *ExecutorContext, nodeRun *NodeRunRecord, node NodeDefinition) (string, map[string]any, error) {
	if r == nil {
		return NodeStatusFailed, nil, fmt.Errorf("executor registry is required")
	}
	executor := r.executors[strings.TrimSpace(node.Type)]
	if executor == nil {
		return NodeStatusFailed, nil, fmt.Errorf("executor %q is not registered", node.Type)
	}
	return executor.Execute(ctx, execCtx, nodeRun, node)
}

type shellExecutor struct{ app core.App }

func (e shellExecutor) Execute(ctx context.Context, execCtx *ExecutorContext, _ *NodeRunRecord, node NodeDefinition) (string, map[string]any, error) {
	command := strings.TrimSpace(stringConfig(node.Config, "command"))
	if command == "" {
		return NodeStatusFailed, nil, fmt.Errorf("shell command is required")
	}
	rendered, err := renderStringTemplate(command, execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	serverID := resolvedServerID(execCtx)
	access, err := servers.ResolveConfigForUserID(e.app, serverID, execCtx.Run.RequestedBy)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	output, err := WorkflowExecuteSSHCommandForTesting(ctx, terminal.ConnectorConfig{
		Host:     access.Host,
		Port:     access.Port,
		User:     access.User,
		AuthType: terminal.CredAuthType(access.AuthType),
		Secret:   access.Secret,
		Shell:    access.Shell,
	}, rendered, durationTimeout(node.TimeoutSec, 30*time.Second))
	result := map[string]any{"stdout": output, "exit_code": 0}
	if err != nil {
		result["stderr"] = err.Error()
		result["exit_code"] = 1
		return NodeStatusFailed, result, err
	}
	result["stderr"] = ""
	return NodeStatusSucceeded, result, nil
}

type dockerExecutor struct{ app core.App }

func (e dockerExecutor) Execute(ctx context.Context, execCtx *ExecutorContext, _ *NodeRunRecord, node NodeDefinition) (string, map[string]any, error) {
	image := strings.TrimSpace(stringConfig(node.Config, "image"))
	command := strings.TrimSpace(stringConfig(node.Config, "command"))
	if image == "" || command == "" {
		return NodeStatusFailed, nil, fmt.Errorf("docker image and command are required")
	}
	renderedImage, err := renderStringTemplate(image, execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	renderedCommand, err := renderStringTemplate(command, execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	serverID := resolvedServerID(execCtx)
	access, err := servers.ResolveConfigForUserID(e.app, serverID, execCtx.Run.RequestedBy)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	dockerCommand := fmt.Sprintf("docker run --rm %s sh -lc %s", shellQuote(renderedImage), shellQuote(renderedCommand))
	output, err := WorkflowExecuteSSHCommandForTesting(ctx, terminal.ConnectorConfig{
		Host:     access.Host,
		Port:     access.Port,
		User:     access.User,
		AuthType: terminal.CredAuthType(access.AuthType),
		Secret:   access.Secret,
		Shell:    access.Shell,
	}, dockerCommand, durationTimeout(node.TimeoutSec, 60*time.Second))
	result := map[string]any{"stdout": output, "exit_code": 0}
	if err != nil {
		result["stderr"] = err.Error()
		result["exit_code"] = 1
		return NodeStatusFailed, result, err
	}
	result["stderr"] = ""
	return NodeStatusSucceeded, result, nil
}

type httpExecutor struct{}

func (httpExecutor) Execute(ctx context.Context, execCtx *ExecutorContext, _ *NodeRunRecord, node NodeDefinition) (string, map[string]any, error) {
	method := strings.ToUpper(strings.TrimSpace(stringConfig(node.Config, "method")))
	if method == "" {
		method = http.MethodGet
	}
	urlValue, err := renderStringTemplate(stringConfig(node.Config, "url"), execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	body, err := renderStringTemplate(stringConfig(node.Config, "body"), execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, urlValue, strings.NewReader(body))
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	for key, value := range stringMapConfig(node.Config, "headers") {
		rendered, renderErr := renderStringTemplate(value, execCtx)
		if renderErr != nil {
			return NodeStatusFailed, nil, renderErr
		}
		req.Header.Set(key, rendered)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	result := map[string]any{"status_code": resp.StatusCode, "response_body": string(responseBody)}
	if resp.StatusCode >= 400 {
		return NodeStatusFailed, result, fmt.Errorf("http request failed with status %d", resp.StatusCode)
	}
	return NodeStatusSucceeded, result, nil
}

type smtpExecutor struct{ app core.App }

func (e smtpExecutor) Execute(_ context.Context, execCtx *ExecutorContext, _ *NodeRunRecord, node NodeDefinition) (string, map[string]any, error) {
	entry, ok := settingsschema.FindEntry("smtp")
	if !ok {
		return NodeStatusFailed, nil, fmt.Errorf("smtp settings entry not found")
	}
	group, err := sysconfig.GetGroup(e.app, "system", entry.PocketBaseGroup, map[string]any{})
	if err != nil && len(group) == 0 {
		return NodeStatusFailed, nil, err
	}
	cfg := smtpConfigFromSettings(group)
	if cfg.Host == "" {
		return NodeStatusFailed, nil, fmt.Errorf("smtp host is not configured")
	}
	serverAddr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	message := mailyak.New(serverAddr, nil)
	from := strings.TrimSpace(cfg.FromAddress)
	if from == "" {
		from = fallbackFromAddress(cfg)
	}
	message.From(from)
	subject, err := renderStringTemplate(stringConfig(node.Config, "subject"), execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	body, err := renderStringTemplate(stringConfig(node.Config, "body"), execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	message.Subject(subject)
	for _, recipient := range stringSliceConfig(node.Config, "to") {
		rendered, renderErr := renderStringTemplate(recipient, execCtx)
		if renderErr != nil {
			return NodeStatusFailed, nil, renderErr
		}
		message.To(rendered)
	}
	plain := message.Plain()
	plain.WriteString(body)
	if err := message.Send(); err != nil {
		return NodeStatusFailed, nil, err
	}
	return NodeStatusSucceeded, map[string]any{"delivered": true}, nil
}

type conditionExecutor struct{}

func (conditionExecutor) Execute(_ context.Context, execCtx *ExecutorContext, _ *NodeRunRecord, node NodeDefinition) (string, map[string]any, error) {
	expression, err := renderStringTemplate(stringConfig(node.Config, "expression"), execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	value := strings.TrimSpace(strings.ToLower(expression))
	matched := value == "true" || value == "1" || value == "yes"
	return NodeStatusSucceeded, map[string]any{"matched": matched, "expression": expression}, nil
}

type manualGateExecutor struct{}

func (manualGateExecutor) Execute(_ context.Context, _ *ExecutorContext, _ *NodeRunRecord, _ NodeDefinition) (string, map[string]any, error) {
	return NodeStatusManualGate, map[string]any{"waiting_for_approval": true}, nil
}

type subworkflowExecutor struct{}

func (subworkflowExecutor) Execute(ctx context.Context, execCtx *ExecutorContext, _ *NodeRunRecord, node NodeDefinition) (string, map[string]any, error) {
	workflowID := strings.TrimSpace(stringConfig(node.Config, "workflow_id"))
	if workflowID == "" {
		return NodeStatusFailed, nil, fmt.Errorf("subworkflow workflow_id is required")
	}
	if execCtx != nil && execCtx.Run != nil && workflowID == execCtx.Run.WorkflowID {
		return NodeStatusFailed, nil, fmt.Errorf("subworkflow recursion is not allowed")
	}
	if execCtx == nil || execCtx.Repo == nil {
		return NodeStatusFailed, nil, fmt.Errorf("executor repository is required")
	}
	svc := NewService(execCtx.Repo)
	prepared, err := svc.PrepareRun(ctx, PrepareRunInput{
		WorkflowID:       workflowID,
		TriggerType:      TriggerManual,
		RequestedBy:      execCtx.Run.RequestedBy,
		RequestedByEmail: execCtx.Run.RequestedByEmail,
		Params:           execCtx.Params,
	})
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	runner := NewRunner(execCtx.Repo)
	childCtx, err := runner.LoadExecutionContext(ctx, prepared.Run.ID, prepared.Run.DefinitionYAML)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	registry := NewExecutorRegistry(execCtx.App)
	result, err := runner.Run(ctx, childCtx, func(runCtx context.Context, nodeRun *NodeRunRecord, childNode NodeDefinition) (string, map[string]any, error) {
		childExecCtx := &ExecutorContext{App: execCtx.App, Definition: mustParseDefinition(prepared.Run.DefinitionYAML), Run: prepared.Run, NodeRuns: childCtx.NodeRuns, Params: execCtx.Params, Repo: execCtx.Repo}
		return registry.Execute(runCtx, childExecCtx, nodeRun, childNode)
	})
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	return NodeStatusSucceeded, map[string]any{"run_id": prepared.Run.ID, "status": result.Status}, nil
}

type llmExecutor struct{ app core.App }

func (e llmExecutor) Execute(ctx context.Context, execCtx *ExecutorContext, _ *NodeRunRecord, node NodeDefinition) (string, map[string]any, error) {
	if execCtx == nil || execCtx.Resolver == nil {
		return NodeStatusFailed, nil, fmt.Errorf("llm provider resolver is required")
	}
	providerID := strings.TrimSpace(stringConfig(node.Config, "provider_id"))
	var provider *copilot.ProviderConfig
	var err error
	if providerID != "" {
		provider, err = execCtx.Resolver.ResolveSelection(ctx, execCtx.Run.RequestedBy, providerID)
	} else {
		provider, err = execCtx.Resolver.ResolveDefault(ctx, execCtx.Run.RequestedBy)
	}
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	prompt, err := renderStringTemplate(stringConfig(node.Config, "prompt"), execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	modelFactory := copilot.EinoModelFactory{App: e.app}
	streamer, err := modelFactory.NewStreamer(ctx, provider)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	var output strings.Builder
	messages := []*copilot.Message{{Role: copilot.RoleUser, Content: prompt, Status: "completed"}}
	final, err := streamer.Stream(ctx, messages, func(chunk string) error {
		output.WriteString(chunk)
		return nil
	})
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	if strings.TrimSpace(final) == "" {
		final = output.String()
	}
	return NodeStatusSucceeded, map[string]any{"content": final}, nil
}

type agentExecutor struct{}

func (agentExecutor) Execute(ctx context.Context, execCtx *ExecutorContext, _ *NodeRunRecord, node NodeDefinition) (string, map[string]any, error) {
	prompt, err := renderStringTemplate(stringConfig(node.Config, "prompt"), execCtx)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	workspace, err := ensureWorkflowWorkspace(execCtx.Run.ID)
	if err != nil {
		return NodeStatusFailed, nil, err
	}
	cmd := workflowExecCommandContext(ctx, "opencode", prompt)
	cmd.Dir = workspace
	output, err := cmd.CombinedOutput()
	result := map[string]any{"workspace": workspace, "stdout": string(output)}
	if err != nil {
		result["exit_error"] = err.Error()
		return NodeStatusFailed, result, err
	}
	return NodeStatusSucceeded, result, nil
}

func renderStringTemplate(input string, execCtx *ExecutorContext) (string, error) {
	if strings.TrimSpace(input) == "" {
		return "", nil
	}
	funcs := template.FuncMap{}
	tpl, err := template.New("workflow").Funcs(funcs).Option("missingkey=zero").Parse(input)
	if err != nil {
		return "", err
	}
	data := map[string]any{
		"params":  execCtx.Params,
		"outputs": collectOutputs(execCtx.NodeRuns),
		"secrets": map[string]any{},
	}
	buffer := bytes.NewBuffer(nil)
	if err := tpl.Execute(buffer, data); err != nil {
		return "", err
	}
	return buffer.String(), nil
}

func collectOutputs(nodeRuns map[string]*NodeRunRecord) map[string]any {
	outputs := map[string]any{}
	for key, nodeRun := range nodeRuns {
		decoded, err := DecodeOutputJSON(nodeRun.OutputJSON)
		if err != nil {
			continue
		}
		outputs[key] = decoded
	}
	return outputs
}

func durationTimeout(timeoutSec int, fallback time.Duration) time.Duration {
	if timeoutSec <= 0 {
		return fallback
	}
	return time.Duration(timeoutSec) * time.Second
}

func stringConfig(config map[string]any, key string) string {
	if config == nil {
		return ""
	}
	if value, ok := config[key]; ok {
		return strings.TrimSpace(fmt.Sprint(value))
	}
	return ""
}

func stringMapConfig(config map[string]any, key string) map[string]string {
	result := map[string]string{}
	if config == nil {
		return result
	}
	raw, ok := config[key]
	if !ok || raw == nil {
		return result
	}
	decoded, ok := raw.(map[string]any)
	if !ok {
		return result
	}
	for k, v := range decoded {
		result[k] = fmt.Sprint(v)
	}
	return result
}

func stringSliceConfig(config map[string]any, key string) []string {
	if config == nil {
		return nil
	}
	raw, ok := config[key]
	if !ok || raw == nil {
		return nil
	}
	items, ok := raw.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, fmt.Sprint(item))
	}
	return result
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func resolvedServerID(execCtx *ExecutorContext) string {
	if execCtx == nil || execCtx.Run == nil {
		return ""
	}
	return strings.TrimSpace(execCtx.Run.ResolvedServerID)
}

func ensureWorkflowWorkspace(runID string) (string, error) {
	dir := filepath.Join(runtimepaths.DataRoot(), "workflow-runs", runID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return dir, nil
}

func mustParseDefinition(definitionYAML string) *Definition {
	def, _ := ParseDefinition(definitionYAML)
	return def
}

type workflowSecretResolver struct{ app core.App }

func (r workflowSecretResolver) Resolve(_ context.Context, secretID, actorID string) (*secrets.ResolveResult, error) {
	return secrets.Resolve(r.app, secretID, actorID)
}

type workflowProviderSelectionResolver struct{ app core.App }

func (r workflowProviderSelectionResolver) ResolveDefaultProviderIDs(context.Context) ([]string, error) {
	return nil, nil
}

type smtpSettingsConfig struct {
	Host        string
	Port        int
	FromAddress string
}

func smtpConfigFromSettings(group map[string]any) smtpSettingsConfig {
	return smtpSettingsConfig{
		Host:        sysconfig.String(group, "host", ""),
		Port:        sysconfig.Int(group, "port", 587),
		FromAddress: sysconfig.String(group, "fromAddress", ""),
	}
}

func fallbackFromAddress(cfg smtpSettingsConfig) string {
	if cfg.FromAddress != "" {
		return cfg.FromAddress
	}
	if cfg.Host != "" {
		return "noreply@" + cfg.Host
	}
	return "noreply@appos.local"
}

var _ = connectorsdomain.Repository(nil)
var _ = aiproviders.Repository(nil)
var _ = cases.Title(language.English)
