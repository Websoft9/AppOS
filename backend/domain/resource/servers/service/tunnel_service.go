package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"

	servers "github.com/websoft9/appos/backend/domain/resource/servers"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

// TunnelTokenProvider abstracts tunnel token lookup and issuance so that the
// service layer has no compile-time dependency on the PocketBase adapter.
type TunnelTokenProvider interface {
	Get(managedServerID string) (rawToken string, found bool, err error)
	GetOrIssue(managedServerID string, wantRotate bool) (token string, changed bool, rotated bool, err error)
}

// Collection (table) names used by the tunnel subsystem.
const (
	CollectionServers   = "servers"
	CollectionAuditLogs = "audit_logs"
)

// Audit action constants for tunnel events.
const (
	ActionTunnelConnect         = "tunnel.connect"
	ActionTunnelDisconnect      = "tunnel.disconnect"
	ActionTunnelPause           = "tunnel.pause"
	ActionTunnelResume          = "tunnel.resume"
	ActionTunnelTokenGenerated  = "tunnel.token_generated"
	ActionTunnelTokenRotated    = "tunnel.token_rotated"
	ActionTunnelConnectRejected = "tunnel.connect_rejected"
	ActionTunnelForwardsUpdated = "tunnel.forwards_updated"
	ActionTunnelPauseExpired    = "tunnel.pause_expired"
)

var (
	ErrTunnelServerNotFound = errors.New("tunnel server not found")
	ErrServerNotTunnel      = errors.New("server is not a tunnel server")
	ErrTunnelTokenNotFound  = errors.New("no tunnel token generated")
	ErrTunnelTokenInvalid   = errors.New("invalid tunnel token")
)

type TunnelService struct {
	App       core.App
	Sessions  *tunnelcore.Registry
	Tokens    TunnelTokenProvider
	Validator tunnelcore.TokenValidator
}

type TunnelForwardInput struct {
	ServiceName string
	LocalPort   int
}

type TunnelSetupResult struct {
	Token          string           `json:"token"`
	AutosshCmd     string           `json:"autossh_cmd"`
	SystemdUnit    string           `json:"systemd_unit"`
	SetupScriptURL string           `json:"setup_script_url"`
	Forwards       []map[string]any `json:"forwards"`
}

type TunnelOverviewResult struct {
	Summary map[string]int   `json:"summary"`
	Items   []map[string]any `json:"items"`
}

type TunnelTokenIssueResult struct {
	Token   string `json:"token"`
	Changed bool   `json:"-"`
	Rotated bool   `json:"-"`
}

type TunnelPauseResult struct {
	OK             bool      `json:"ok"`
	Status         string    `json:"status"`
	PauseUntil     string    `json:"pause_until"`
	PauseUntilTime time.Time `json:"-"`
}

type TunnelStatusResult struct {
	Status      string `json:"status"`
	ConnectedAt string `json:"connected_at,omitempty"`
	LastSeen    string `json:"last_seen,omitempty"`
	Services    any    `json:"services,omitempty"`
}

type TunnelDisconnectResult struct {
	OK          bool   `json:"ok"`
	Status      string `json:"status"`
	WasActive   bool   `json:"-"`
	Reason      string `json:"-"`
	ReasonLabel string `json:"-"`
}

type TunnelForwardsResult struct {
	Forwards []map[string]any `json:"forwards"`
}

func (s TunnelService) loadManagedServer(serverID string) (*core.Record, *servers.ManagedServer, error) {
	record, err := s.App.FindRecordById(CollectionServers, serverID)
	if err != nil {
		return nil, nil, ErrTunnelServerNotFound
	}

	managedServer := servers.ManagedServerFromRecord(record)
	if managedServer == nil || !managedServer.IsTunnel() {
		return nil, nil, ErrServerNotTunnel
	}

	return record, managedServer, nil
}

func (s TunnelService) BuildSetupForServer(serverID, apposHost, sshPort string) (TunnelSetupResult, error) {
	_, managedServer, err := s.loadManagedServer(serverID)
	if err != nil {
		return TunnelSetupResult{}, fmt.Errorf("load server %s: %w", serverID, err)
	}

	rawToken, found, err := s.Tokens.Get(serverID)
	if err != nil {
		return TunnelSetupResult{}, fmt.Errorf("get token for %s: %w", serverID, err)
	}
	if !found {
		return TunnelSetupResult{}, ErrTunnelTokenNotFound
	}

	return s.BuildSetup(managedServer, rawToken, apposHost, sshPort)
}

func (s TunnelService) BuildSetupScriptByToken(rawToken, apposHost, sshPort string) (string, error) {
	managedServerID, ok := s.Validator.Validate(rawToken)
	if !ok {
		return "", ErrTunnelTokenInvalid
	}

	_, managedServer, err := s.loadManagedServer(managedServerID)
	if err != nil {
		if errors.Is(err, ErrTunnelServerNotFound) || errors.Is(err, ErrServerNotTunnel) {
			return "", ErrTunnelTokenInvalid
		}
		return "", fmt.Errorf("load server for token: %w", err)
	}

	return s.BuildSetupScript(managedServer, rawToken, apposHost, sshPort)
}

func (s TunnelService) Forwards(serverID string) (TunnelForwardsResult, error) {
	_, managedServer, err := s.loadManagedServer(serverID)
	if err != nil {
		return TunnelForwardsResult{}, fmt.Errorf("load server %s: %w", serverID, err)
	}

	forwards, err := managedServer.TunnelForwardSpecs()
	if err != nil {
		return TunnelForwardsResult{}, fmt.Errorf("parse forwards for %s: %w", serverID, err)
	}

	return TunnelForwardsResult{Forwards: ForwardSpecsToResponse(forwards)}, nil
}

func (s TunnelService) ReplaceForwards(serverID string, inputs []TunnelForwardInput) (TunnelForwardsResult, error) {
	record, _, err := s.loadManagedServer(serverID)
	if err != nil {
		return TunnelForwardsResult{}, fmt.Errorf("load server %s: %w", serverID, err)
	}

	forwards, err := s.ValidateForwardInputs(inputs)
	if err != nil {
		return TunnelForwardsResult{}, fmt.Errorf("validate forwards: %w", err)
	}

	raw, err := json.Marshal(forwards)
	if err != nil {
		return TunnelForwardsResult{}, fmt.Errorf("marshal forwards: %w", err)
	}

	record.Set("tunnel_forwards", string(raw))
	if err := s.App.Save(record); err != nil {
		return TunnelForwardsResult{}, fmt.Errorf("save forwards for %s: %w", serverID, err)
	}

	return TunnelForwardsResult{Forwards: ForwardSpecsToResponse(forwards)}, nil
}

func (s TunnelService) GetOrIssueToken(managedServerID string, wantRotate bool) (TunnelTokenIssueResult, error) {
	_, _, err := s.loadManagedServer(managedServerID)
	if err != nil {
		return TunnelTokenIssueResult{}, fmt.Errorf("load server %s: %w", managedServerID, err)
	}

	token, changed, rotated, err := s.Tokens.GetOrIssue(managedServerID, wantRotate)
	if err != nil {
		return TunnelTokenIssueResult{}, fmt.Errorf("issue token for %s: %w", managedServerID, err)
	}

	return TunnelTokenIssueResult{
		Token:   token,
		Changed: changed,
		Rotated: rotated,
	}, nil

}

func (s TunnelService) Pause(record *core.Record, minutes float64) (TunnelPauseResult, error) {
	if s.Sessions != nil {
		if _, ok := s.Sessions.Get(record.Id); ok {
			s.Sessions.Disconnect(record.Id, tunnelcore.DisconnectReasonPausedByOperator)
		}
	}

	now := time.Now().UTC()
	pauseUntil := now.Add(time.Duration(minutes * float64(time.Minute)))
	record.Set("tunnel_pause_until", pauseUntil)
	if err := s.App.Save(record); err != nil {
		return TunnelPauseResult{}, fmt.Errorf("save pause for %s: %w", record.Id, err)
	}

	return TunnelPauseResult{
		OK:             true,
		Status:         string(servers.TunnelStatusPaused),
		PauseUntil:     servers.FormatTunnelTime(pauseUntil),
		PauseUntilTime: pauseUntil,
	}, nil

}

func (s TunnelService) Resume(record *core.Record) (TunnelPauseResult, error) {
	record.Set("tunnel_pause_until", nil)
	if err := s.App.Save(record); err != nil {
		return TunnelPauseResult{}, fmt.Errorf("save resume for %s: %w", record.Id, err)
	}

	return TunnelPauseResult{
		OK:         true,
		Status:     string(servers.TunnelStatusOffline),
		PauseUntil: "",
	}, nil
}

func (s TunnelService) Status(record *core.Record) (TunnelStatusResult, error) {
	if s.Sessions != nil {
		if sess, ok := s.Sessions.Get(record.Id); ok {
			return TunnelStatusResult{
				Status:      string(servers.TunnelStatusOnline),
				ConnectedAt: sess.ConnectedAt.Format(time.RFC3339),
				Services:    sess.Services,
			}, nil
		}
	}

	runtime := servers.TunnelRuntimeFromRecord(record)
	status := runtime.Status
	if runtime.IsPausedAt(time.Now().UTC()) && status != servers.TunnelStatusOnline {
		status = servers.TunnelStatusPaused
	}

	var services any
	raw := runtime.ServicesRaw
	if raw != "" && raw != "null" {
		_ = json.Unmarshal([]byte(raw), &services)
	}

	return TunnelStatusResult{
		Status:   string(status),
		LastSeen: servers.FormatTunnelTime(runtime.LastSeen),
		Services: services,
	}, nil
}

func (s TunnelService) Disconnect(managedServerID string) (TunnelDisconnectResult, error) {
	_, _, err := s.loadManagedServer(managedServerID)
	if err != nil {
		return TunnelDisconnectResult{}, fmt.Errorf("load server %s: %w", managedServerID, err)
	}

	active := false
	if s.Sessions != nil {
		if _, ok := s.Sessions.Get(managedServerID); ok {
			active = true
			s.Sessions.Disconnect(managedServerID, tunnelcore.DisconnectReasonOperatorDisconnect)
		}
	}

	status := string(servers.TunnelStatusOffline)
	if active {
		status = "disconnecting"
	}

	return TunnelDisconnectResult{
		OK:          true,
		Status:      status,
		WasActive:   active,
		Reason:      string(tunnelcore.DisconnectReasonOperatorDisconnect),
		ReasonLabel: "Disconnected by operator",
	}, nil
}

func (s TunnelService) ValidateForwardInputs(inputs []TunnelForwardInput) ([]tunnelcore.ForwardSpec, error) {
	if len(inputs) == 0 {
		return nil, fmt.Errorf("at least one forward is required")
	}

	forwards := make([]tunnelcore.ForwardSpec, 0, len(inputs))
	seenNames := make(map[string]struct{}, len(inputs))
	seenPorts := make(map[int]struct{}, len(inputs))
	hasSSH := false

	for _, item := range inputs {
		name := strings.TrimSpace(item.ServiceName)
		if name == "" {
			return nil, fmt.Errorf("service_name is required")
		}
		if item.LocalPort < 1 || item.LocalPort > 65535 {
			return nil, fmt.Errorf("local_port must be between 1 and 65535")
		}
		if _, exists := seenNames[name]; exists {
			return nil, fmt.Errorf("duplicate service_name: %s", name)
		}
		if _, exists := seenPorts[item.LocalPort]; exists {
			return nil, fmt.Errorf("duplicate local_port: %d", item.LocalPort)
		}
		if name == "ssh" && item.LocalPort == 22 {
			hasSSH = true
		}

		seenNames[name] = struct{}{}
		seenPorts[item.LocalPort] = struct{}{}
		forwards = append(forwards, tunnelcore.ForwardSpec{Name: name, LocalPort: item.LocalPort})
	}

	if !hasSSH {
		return nil, fmt.Errorf("an ssh forward on local_port 22 is required")
	}

	return forwards, nil
}

func ForwardSpecsToResponse(forwards []tunnelcore.ForwardSpec) []map[string]any {
	out := make([]map[string]any, 0, len(forwards))
	for _, forward := range forwards {
		out = append(out, map[string]any{
			"service_name": forward.Name,
			"local_port":   forward.LocalPort,
		})
	}
	return out
}
