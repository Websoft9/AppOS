package servers

import (
	"encoding/json"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	sec "github.com/websoft9/appos/backend/domain/secrets"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

// ConnectionMode identifies how a managed server is accessed.
type ConnectionMode string

const (
	// ConnectionModeDirect connects to the server host directly over TCP.
	ConnectionModeDirect ConnectionMode = "direct"
	// ConnectionModeTunnel connects via a relay tunnel established by the agent.
	ConnectionModeTunnel ConnectionMode = "tunnel"
)

// IsValid reports whether the connection mode is a recognised supported value.
func (m ConnectionMode) IsValid() bool {
	return m == ConnectionModeDirect || m == ConnectionModeTunnel
}

// ManagedServer is the catalog aggregate root for a registered managed node.
// It holds only configuration state; runtime connectivity state (tunnel
// status, active services) lives in TunnelRuntime.
type ManagedServer struct {
	ID             string
	Name           string
	Host           string
	Port           int
	User           string
	ConnectType    ConnectionMode
	CredentialID   string
	Shell          string
	TunnelForwards string
	Description    string
}

func LoadManagedServer(app core.App, serverID string) (*ManagedServer, error) {
	record, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return nil, fmt.Errorf("server not found: %w", err)
	}
	return ManagedServerFromRecord(record), nil
}

func ListManagedServers(app core.App) ([]*ManagedServer, error) {
	records, err := app.FindAllRecords("servers")
	if err != nil {
		return nil, err
	}

	items := make([]*ManagedServer, 0, len(records))
	for _, record := range records {
		items = append(items, ManagedServerFromRecord(record))
	}
	return items, nil
}

func ManagedServerFromRecord(record *core.Record) *ManagedServer {
	if record == nil {
		return nil
	}

	port := record.GetInt("port")
	if port == 0 {
		port = 22
	}

	ct := ConnectionMode(record.GetString("connect_type"))
	if !ct.IsValid() {
		ct = ConnectionModeDirect
	}

	return &ManagedServer{
		ID:             record.Id,
		Name:           record.GetString("name"),
		Host:           record.GetString("host"),
		Port:           port,
		User:           record.GetString("user"),
		ConnectType:    ct,
		CredentialID:   record.GetString("credential"),
		Shell:          record.GetString("shell"),
		TunnelForwards: record.GetString("tunnel_forwards"),
		Description:    record.GetString("description"),
	}
}

func (s *ManagedServer) IsTunnel() bool {
	return s != nil && s.ConnectType == ConnectionModeTunnel
}

func (s *ManagedServer) TunnelForwardSpecs() ([]tunnelcore.ForwardSpec, error) {
	if s == nil || s.TunnelForwards == "" || s.TunnelForwards == "null" {
		return tunnelcore.DefaultForwardSpecs(), nil
	}

	var forwards []tunnelcore.ForwardSpec
	if err := json.Unmarshal([]byte(s.TunnelForwards), &forwards); err != nil {
		return nil, err
	}
	if len(forwards) == 0 {
		return tunnelcore.DefaultForwardSpecs(), nil
	}
	return forwards, nil
}

func ResolveConfigForUserID(app core.App, serverID string, userID string) (AccessConfig, error) {
	record, err := app.FindRecordById("servers", serverID)
	if err != nil {
		return AccessConfig{}, fmt.Errorf("server not found: %w", err)
	}
	server := ManagedServerFromRecord(record)
	rt := TunnelRuntimeFromRecord(record)

	cfg, err := server.AccessConfig(app, userID)
	if err != nil {
		return AccessConfig{}, err
	}
	server.ApplyBestEffortTunnel(&cfg, rt)
	return cfg, nil
}

func (s *ManagedServer) AccessConfig(app core.App, userID string) (AccessConfig, error) {
	if s == nil {
		return AccessConfig{}, fmt.Errorf("server is required")
	}

	cfg := AccessConfig{
		Host:  s.Host,
		Port:  s.Port,
		User:  s.User,
		Shell: s.Shell,
	}

	if err := s.applyCredential(app, userID, &cfg); err != nil {
		return AccessConfig{}, err
	}

	return cfg, nil
}

// ApplyBestEffortTunnel rewrites Host/Port in cfg to the locally-forwarded tunnel
// address when this server uses ConnectionModeTunnel. rt provides the runtime
// services map; if the ssh service is not yet advertised the cfg is left unchanged.
func (s *ManagedServer) ApplyBestEffortTunnel(cfg *AccessConfig, rt TunnelRuntime) {
	if s == nil || cfg == nil {
		return
	}
	if s.ConnectType != ConnectionModeTunnel {
		return
	}

	sshPort, err := TunnelSSHPortFromServices(rt.ServicesRaw)
	if err != nil {
		return
	}
	if sshPort <= 0 {
		return
	}

	cfg.Host = "127.0.0.1"
	cfg.Port = sshPort
}

// ResolveDockerSSHAddress returns the effective SSH host/port for Docker API access.
// For tunnel servers, rt provides the live runtime state; the tunnel must be online.
func (s *ManagedServer) ResolveDockerSSHAddress(rt TunnelRuntime) (string, int, error) {
	if s == nil {
		return "", 0, fmt.Errorf("server is required")
	}

	if s.ConnectType != ConnectionModeTunnel {
		return s.Host, s.Port, nil
	}
	if rt.Status != TunnelStatusOnline {
		return "", 0, fmt.Errorf("tunnel server %s is offline", s.ID)
	}

	sshPort, err := TunnelSSHPortFromServices(rt.ServicesRaw)
	if err != nil {
		return "", 0, err
	}
	return "127.0.0.1", sshPort, nil
}

func (s *ManagedServer) applyCredential(app core.App, userID string, cfg *AccessConfig) error {
	if s == nil || cfg == nil {
		return fmt.Errorf("server config target is required")
	}
	if s.CredentialID == "" {
		return nil
	}
	if userID == "" {
		userID = sec.CreatedSourceSystem
	}

	cfg.AuthType = CredentialAuthType(app, s.CredentialID)
	result, err := sec.Resolve(app, s.CredentialID, userID)
	if err != nil {
		return fmt.Errorf("credential resolve failed: %w", err)
	}

	switch cfg.AuthType {
	case AuthMethodPassword:
		cfg.Secret = sec.FirstStringFromPayload(result.Payload, "password", "value")
	default:
		cfg.Secret = sec.FirstStringFromPayload(result.Payload, "private_key", "key", "value")
	}
	if cfg.Secret == "" {
		return fmt.Errorf("credential resolve: no usable value in payload for auth_type %q", cfg.AuthType)
	}

	return nil
}
