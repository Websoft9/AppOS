package routes

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
	cryptossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"

	"github.com/websoft9/appos/backend/internal/audit"
	servers "github.com/websoft9/appos/backend/internal/servers"
)

func registerServerOpsRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	serverOps := g.Group("/{serverId}/ops")
	serverOps.GET("/connectivity", handleServerConnectivity)
	serverOps.POST("/power", handleServerPower)
	serverOps.GET("/ports", handleServerPortsList)
	serverOps.GET("/ports/{port}", handleServerPortInspect)
	serverOps.POST("/ports/{port}/release", handleServerPortRelease)
	serverOps.GET("/systemd/services", handleSystemdServices)
	serverOps.GET("/systemd/{service}/status", handleSystemdServiceStatus)
	serverOps.GET("/systemd/{service}/content", handleSystemdServiceContent)
	serverOps.GET("/systemd/{service}/logs", handleSystemdServiceLogs)
	serverOps.POST("/systemd/{service}/action", handleSystemdServiceAction)
	serverOps.GET("/systemd/{service}/unit", handleSystemdServiceUnitRead)
	serverOps.PUT("/systemd/{service}/unit", handleSystemdServiceUnitWrite)
	serverOps.POST("/systemd/{service}/unit/verify", handleSystemdServiceUnitVerify)
	serverOps.POST("/systemd/{service}/unit/apply", handleSystemdServiceUnitApply)
}

// ════════════════════════════════════════════════════════════
// Shared helpers & SSH infrastructure (Story 20.4)
// ════════════════════════════════════════════════════════════

var systemdServicePattern = regexp.MustCompile(`^[a-zA-Z0-9@._-]+(?:\.service)?$`)
var ssUsersProcessPattern = regexp.MustCompile(`\("([^"]+)",pid=([0-9]+),fd=[0-9]+\)`)
var dockerPublishedPortPattern = regexp.MustCompile(`:([0-9]+)->[^/]+/(tcp|udp)`)

func normalizeServiceName(name string) (string, error) {
	service := strings.TrimSpace(name)
	if service == "" {
		return "", fmt.Errorf("service required")
	}
	if !systemdServicePattern.MatchString(service) {
		return "", fmt.Errorf("invalid service name")
	}
	if !strings.HasSuffix(service, ".service") {
		service += ".service"
	}
	return service, nil
}

func normalizePortInspectParams(e *core.RequestEvent) (string, string, error) {
	protocol := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("protocol")))
	if protocol == "" {
		protocol = "tcp"
	}
	if protocol != "tcp" && protocol != "udp" {
		return "", "", fmt.Errorf("protocol must be tcp or udp")
	}

	view := strings.ToLower(strings.TrimSpace(e.Request.URL.Query().Get("view")))
	if view == "" {
		view = "all"
	}
	if view != "occupancy" && view != "reservation" && view != "all" {
		return "", "", fmt.Errorf("view must be occupancy, reservation, or all")
	}

	return protocol, view, nil
}

func normalizePortReleaseMode(raw string) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(raw))
	if mode == "" {
		return "graceful", nil
	}
	if mode != "graceful" && mode != "force" {
		return "", fmt.Errorf("mode must be graceful or force")
	}
	return mode, nil
}

func normalizeConnectivityMode(raw string, defaultMode string) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(raw))
	if mode == "" {
		mode = defaultMode
	}
	if mode == "" {
		mode = "tcp"
	}
	if mode != "tcp" && mode != "ssh" && mode != "tunnel" {
		return "", fmt.Errorf("mode must be tcp, ssh, or tunnel")
	}
	return mode, nil
}

// ════════════════════════════════════════════════════════════
// Connectivity & Power handlers
// ════════════════════════════════════════════════════════════

// handleServerConnectivity checks server connectivity mode (tcp/ssh/tunnel).
func handleServerConnectivity(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	server, err := e.App.FindRecordById("servers", serverID)
	if err != nil {
		return e.NotFoundError("server not found", err)
	}

	defaultMode := "tcp"
	if strings.EqualFold(server.GetString("connect_type"), "tunnel") {
		defaultMode = "tunnel"
	}

	mode, err := normalizeConnectivityMode(e.Request.URL.Query().Get("mode"), defaultMode)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	response := map[string]any{"status": "offline", "mode": mode}

	switch mode {
	case "tunnel":
		if tunnelSessions != nil {
			if _, ok := tunnelSessions.Get(serverID); ok {
				response["status"] = "online"
			}
		}
		return e.JSON(http.StatusOK, response)
	case "ssh":
		cfg, cfgErr := resolveServerConfig(e, serverID)
		if cfgErr != nil {
			response["reason"] = cfgErr.Error()
			return e.JSON(http.StatusOK, response)
		}
		ctx, cancel := context.WithTimeout(e.Request.Context(), 8*time.Second)
		defer cancel()

		start := time.Now()
		sess, connErr := (&servers.SSHConnector{}).Connect(ctx, cfg)
		if connErr != nil {
			response["reason"] = connErr.Error()
			var ce *servers.ConnectError
			if errors.As(connErr, &ce) {
				response["category"] = string(ce.Category)
				response["reason"] = ce.Message
			}
			return e.JSON(http.StatusOK, response)
		}
		_ = sess.Close()
		response["status"] = "online"
		response["latency_ms"] = time.Since(start).Milliseconds()
		return e.JSON(http.StatusOK, response)
	default:
		host := server.GetString("host")
		port := server.GetInt("port")
		if port == 0 {
			port = 22
		}
		if strings.TrimSpace(host) == "" {
			response["reason"] = "server host is empty"
			return e.JSON(http.StatusOK, response)
		}
		addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
		start := time.Now()
		conn, dialErr := net.DialTimeout("tcp", addr, 5*time.Second)
		if dialErr != nil {
			response["reason"] = dialErr.Error()
			return e.JSON(http.StatusOK, response)
		}
		_ = conn.Close()
		response["status"] = "online"
		response["latency_ms"] = time.Since(start).Milliseconds()
		return e.JSON(http.StatusOK, response)
	}
}

func handleServerPower(e *core.RequestEvent) error {
	serverID := e.Request.PathValue("serverId")
	if serverID == "" {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "serverId required"})
	}

	var body struct {
		Action string `json:"action"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "invalid request body"})
	}

	action := strings.ToLower(strings.TrimSpace(body.Action))
	var command string
	switch action {
	case "restart":
		command = "(sudo -n systemctl reboot || sudo -n reboot || systemctl reboot || reboot)"
	case "shutdown":
		command = "(sudo -n systemctl poweroff || sudo -n shutdown -h now || systemctl poweroff || shutdown -h now)"
	default:
		return e.JSON(http.StatusBadRequest, map[string]any{"message": "action must be restart or shutdown"})
	}

	cfg, err := resolveServerConfig(e, serverID)
	if err != nil {
		return e.JSON(http.StatusBadRequest, map[string]any{"message": err.Error()})
	}

	output, runErr := executeSSHCommand(e.Request.Context(), cfg, command, 20*time.Second)
	expectedDisconnect := runErr != nil && isExpectedPowerDisconnect(runErr)
	userID, _, ip, _ := clientInfo(e)
	status := audit.StatusSuccess
	if runErr != nil && !expectedDisconnect {
		status = audit.StatusFailed
	}
	audit.Write(e.App, audit.Entry{
		UserID:       userID,
		Action:       "terminal.server.power",
		ResourceType: "server",
		ResourceID:   serverID,
		Status:       status,
		IP:           ip,
		Detail:       map[string]any{"action": action, "output": output},
	})

	if runErr != nil && !expectedDisconnect {
		return e.JSON(http.StatusInternalServerError, map[string]any{"message": runErr.Error(), "output": output})
	}
	if expectedDisconnect {
		return e.JSON(http.StatusAccepted, map[string]any{"server_id": serverID, "action": action, "status": "accepted", "output": output})
	}

	return e.JSON(http.StatusOK, map[string]any{"server_id": serverID, "action": action, "status": "accepted", "output": output})
}

func isExpectedPowerDisconnect(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "connection reset") ||
		strings.Contains(message, "broken pipe") ||
		strings.Contains(message, "use of closed network connection") ||
		strings.Contains(message, "unexpected eof")
}

// ════════════════════════════════════════════════════════════
// SSH command execution infrastructure
// ════════════════════════════════════════════════════════════

func shellQuote(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}

var (
	cachedHostKeyCB   cryptossh.HostKeyCallback
	cachedHostKeyCBOK bool
)

func sshHostKeyCallback() (cryptossh.HostKeyCallback, error) {
	if cachedHostKeyCBOK {
		return cachedHostKeyCB, nil
	}

	cb, err := resolveHostKeyCallback()
	if err != nil {
		return nil, err
	}
	cachedHostKeyCB = cb
	cachedHostKeyCBOK = true
	return cb, nil
}

func resolveHostKeyCallback() (cryptossh.HostKeyCallback, error) {
	knownHostsPath := strings.TrimSpace(os.Getenv("APPOS_SSH_KNOWN_HOSTS"))
	candidates := make([]string, 0, 3)
	if knownHostsPath != "" {
		candidates = append(candidates, knownHostsPath)
	}
	if homeDir, err := os.UserHomeDir(); err == nil && homeDir != "" {
		candidates = append(candidates, filepath.Join(homeDir, ".ssh", "known_hosts"))
	}
	candidates = append(candidates, "/etc/ssh/ssh_known_hosts")

	existing := make([]string, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, ok := seen[candidate]; ok {
			continue
		}
		seen[candidate] = struct{}{}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			existing = append(existing, candidate)
		}
	}

	if len(existing) > 0 {
		callback, err := knownhosts.New(existing...)
		if err != nil {
			return nil, fmt.Errorf("load known_hosts: %w", err)
		}
		return callback, nil
	}

	requireStrict := strings.ToLower(strings.TrimSpace(os.Getenv("APPOS_REQUIRE_SSH_HOST_KEY")))
	if requireStrict == "1" || requireStrict == "true" || requireStrict == "yes" {
		return nil, fmt.Errorf("ssh host key verification required: no known_hosts file found (set by APPOS_REQUIRE_SSH_HOST_KEY)")
	}

	return cryptossh.InsecureIgnoreHostKey(), nil
}

func executeSSHCommand(ctx context.Context, cfg servers.ConnectorConfig, command string, timeout time.Duration) (string, error) {
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	cmdCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	authMethod, err := servers.AuthMethodFromConfig(cfg)
	if err != nil {
		return "", err
	}
	hostKeyCallback, err := sshHostKeyCallback()
	if err != nil {
		return "", err
	}

	clientCfg := &cryptossh.ClientConfig{
		User:            cfg.User,
		Auth:            []cryptossh.AuthMethod{authMethod},
		HostKeyCallback: hostKeyCallback,
		Timeout:         10 * time.Second,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))
	type dialResult struct {
		client *cryptossh.Client
		err    error
	}
	dialCh := make(chan dialResult, 1)
	go func() {
		client, dialErr := cryptossh.Dial("tcp", addr, clientCfg)
		dialCh <- dialResult{client: client, err: dialErr}
	}()

	var client *cryptossh.Client
	select {
	case <-cmdCtx.Done():
		return "", cmdCtx.Err()
	case result := <-dialCh:
		if result.err != nil {
			return "", fmt.Errorf("ssh dial failed: %w", result.err)
		}
		client = result.client
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		return "", fmt.Errorf("ssh new session failed: %w", err)
	}
	defer session.Close()

	type commandResult struct {
		output []byte
		err    error
	}
	cmdCh := make(chan commandResult, 1)
	go func() {
		out, cmdErr := session.CombinedOutput(command)
		cmdCh <- commandResult{output: out, err: cmdErr}
	}()

	select {
	case <-cmdCtx.Done():
		_ = session.Close()
		return "", cmdCtx.Err()
	case result := <-cmdCh:
		output := strings.TrimSpace(string(result.output))
		if result.err != nil {
			if output == "" {
				return output, result.err
			}
			return output, fmt.Errorf("%w: %s", result.err, output)
		}
		return output, nil
	}
}
