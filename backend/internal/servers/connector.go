// Package terminal provides browser-based terminal access via WebSocket.
//
// Supported connectors:
//   - SSHConnector  — SSH PTY relay for registered servers (Resource Store)
//   - SFTPConnector — REST file operations over SSH transport
//   - DockerExecConnector — Docker exec PTY relay (Story 20.2)
package terminal

import (
	"context"
	"fmt"
)

// ─── Connection Error Classification ──────────────────────────────────────────

// ConnectErrorCategory classifies the reason a connection attempt failed.
// Frontend and API consumers use this to display specific, actionable messages.
type ConnectErrorCategory string

const (
	// ErrCatAuthFailed — credentials were rejected by the remote server.
	ErrCatAuthFailed ConnectErrorCategory = "auth_failed"
	// ErrCatNetworkUnreachable — TCP dial timed out or host is unreachable.
	ErrCatNetworkUnreachable ConnectErrorCategory = "network_unreachable"
	// ErrCatConnectionRefused — remote port actively refused the connection.
	ErrCatConnectionRefused ConnectErrorCategory = "connection_refused"
	// ErrCatCredentialInvalid — local credential config error (bad key format, unsupported auth type).
	ErrCatCredentialInvalid ConnectErrorCategory = "credential_invalid"
	// ErrCatSessionFailed — SSH handshake succeeded but PTY/shell setup failed.
	ErrCatSessionFailed ConnectErrorCategory = "session_failed"
	// ErrCatServerDisconnected — server closed the connection unexpectedly.
	ErrCatServerDisconnected ConnectErrorCategory = "server_disconnected"
)

// ConnectError is a structured error returned by Connector.Connect that carries
// a machine-readable category alongside the human-readable message.
type ConnectError struct {
	Category ConnectErrorCategory
	Message  string
	Cause    error
}

func (e *ConnectError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %s: %v", e.Category, e.Message, e.Cause)
	}
	return fmt.Sprintf("%s: %s", e.Category, e.Message)
}

func (e *ConnectError) Unwrap() error { return e.Cause }

// NewConnectError creates a ConnectError with the given category and message.
func NewConnectError(cat ConnectErrorCategory, msg string, cause error) *ConnectError {
	return &ConnectError{Category: cat, Message: msg, Cause: cause}
}

// Session is the common interface for streaming terminal connectors (SSH, Docker exec).
// It bridges a remote PTY with a WebSocket: callers Write stdin bytes and Read
// stdout/stderr bytes. Control messages (resize, close) are handled out-of-band
// by the WebSocket route handler.
//
// SFTPConnector does NOT implement Session — it is a stateless REST service.
type Session interface {
	// Write sends bytes to the remote stdin (keyboard input).
	Write(p []byte) (n int, err error)
	// Read receives bytes from the remote stdout/stderr (terminal output).
	Read(p []byte) (n int, err error)
	// Resize changes the remote PTY dimensions.
	Resize(rows, cols uint16) error
	// Close terminates the session and frees all resources.
	Close() error
}

// Connector creates a Session for a given server configuration.
// Implementations must be safe for concurrent use.
type Connector interface {
	Connect(ctx context.Context, cfg ConnectorConfig) (Session, error)
}

// ConnectorConfig carries the parameters required to open a connection.
type ConnectorConfig struct {
	// Host is the target hostname or IP address.
	Host string
	// Port is the target TCP port (e.g. 22 for SSH).
	Port int
	// User is the login username.
	User string
	// AuthType is "password" or "private_key".
	AuthType string
	// Secret is the decrypted credential value (password or PEM private key).
	Secret string
	// Shell overrides the login shell (empty = server default).
	Shell string
}
