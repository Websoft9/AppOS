// Package terminal provides browser-based terminal access via WebSocket.
//
// Supported connectors:
//   - SSHConnector  — SSH PTY relay for registered servers (Resource Store)
//   - SFTPConnector — REST file operations over SSH transport
//   - DockerExecConnector — Docker exec PTY relay (Story 15.3)
package terminal

import "context"

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
