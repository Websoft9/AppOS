package servers

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	sec "github.com/websoft9/appos/backend/domain/secrets"
	tunnelcore "github.com/websoft9/appos/backend/infra/tunnelcore"
)

type ManagedServer struct {
	ID             string
	Name           string
	Host           string
	Port           int
	User           string
	ConnectType    string
	CredentialID   string
	Shell          string
	TunnelForwards string
	TunnelStatus   string
	TunnelServices string
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

	return &ManagedServer{
		ID:             record.Id,
		Name:           record.GetString("name"),
		Host:           record.GetString("host"),
		Port:           port,
		User:           record.GetString("user"),
		ConnectType:    record.GetString("connect_type"),
		CredentialID:   record.GetString("credential"),
		Shell:          record.GetString("shell"),
		TunnelForwards: record.GetString("tunnel_forwards"),
		TunnelStatus:   record.GetString("tunnel_status"),
		TunnelServices: record.GetString("tunnel_services"),
		Description:    record.GetString("description"),
	}
}

func (s *ManagedServer) IsTunnel() bool {
	return s != nil && strings.EqualFold(s.ConnectType, "tunnel")
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

func ResolveConfigForUserID(app core.App, serverID string, userID string) (ConnectorConfig, error) {
	server, err := LoadManagedServer(app, serverID)
	if err != nil {
		return ConnectorConfig{}, err
	}

	cfg, err := server.ConnectorConfig(app, userID)
	if err != nil {
		return ConnectorConfig{}, err
	}
	server.ApplyBestEffortTunnel(&cfg)
	return cfg, nil
}

func (s *ManagedServer) ConnectorConfig(app core.App, userID string) (ConnectorConfig, error) {
	if s == nil {
		return ConnectorConfig{}, fmt.Errorf("server is required")
	}

	cfg := ConnectorConfig{
		Host:  s.Host,
		Port:  s.Port,
		User:  s.User,
		Shell: s.Shell,
	}

	if err := s.applyCredential(app, userID, &cfg); err != nil {
		return ConnectorConfig{}, err
	}

	return cfg, nil
}

func (s *ManagedServer) ApplyBestEffortTunnel(cfg *ConnectorConfig) {
	if s == nil || cfg == nil {
		return
	}
	if !strings.EqualFold(s.ConnectType, "tunnel") {
		return
	}

	sshPort, err := TunnelSSHPortFromServices(s.TunnelServices)
	if err != nil {
		return
	}
	if sshPort <= 0 {
		return
	}

	cfg.Host = "127.0.0.1"
	cfg.Port = sshPort
}

func (s *ManagedServer) ResolveDockerSSHAddress() (string, int, error) {
	if s == nil {
		return "", 0, fmt.Errorf("server is required")
	}

	if !strings.EqualFold(s.ConnectType, "tunnel") {
		return s.Host, s.Port, nil
	}
	if s.TunnelStatus != "online" {
		return "", 0, fmt.Errorf("tunnel server %s is offline", s.ID)
	}

	sshPort, err := TunnelSSHPortFromServices(s.TunnelServices)
	if err != nil {
		return "", 0, err
	}
	return "127.0.0.1", sshPort, nil
}

func (s *ManagedServer) applyCredential(app core.App, userID string, cfg *ConnectorConfig) error {
	if s == nil || cfg == nil {
		return fmt.Errorf("server config target is required")
	}
	if s.CredentialID == "" {
		return nil
	}

	cfg.AuthType = CredentialAuthType(app, s.CredentialID)
	result, err := sec.Resolve(app, s.CredentialID, userID)
	if err != nil {
		return fmt.Errorf("credential resolve failed: %w", err)
	}

	switch cfg.AuthType {
	case "password":
		cfg.Secret = sec.FirstStringFromPayload(result.Payload, "password", "value")
	default:
		cfg.Secret = sec.FirstStringFromPayload(result.Payload, "private_key", "key", "value")
	}
	if cfg.Secret == "" {
		return fmt.Errorf("credential resolve: no usable value in payload for auth_type %q", cfg.AuthType)
	}

	return nil
}
