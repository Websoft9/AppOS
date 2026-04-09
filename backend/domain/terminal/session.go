// Package terminal provides the core abstractions for interactive terminal sessions.
//
// A terminal session lets a human (or automation) interact with any resource
// that exposes a CLI: servers (SSH), containers (Docker exec), databases
// (mysql / psql / redis-cli), cloud CLIs (aws / gcloud / az), or the local host (bash).
//
// Supported connectors (current):
//   - SSHConnector         — SSH PTY for registered managed servers
//   - SFTPClient           — REST file operations over SSH transport
//   - DockerExecConnector  — Docker exec PTY for local containers
//   - LocalSession         — local bash PTY (system terminal)
package terminal

import "context"

// Session is the common interface for streaming terminal connectors.
// It bridges a remote PTY with a WebSocket: callers Write stdin bytes and Read
// stdout/stderr bytes. Control messages (resize, close) are handled out-of-band
// by the WebSocket route handler.
//
// SFTPClient does NOT implement Session — it is a stateless REST service.
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

// Connector creates a Session for a given transport configuration.
// Implementations must be safe for concurrent use.
//
// ConnectorConfig is transport-level input. Application services are expected
// to map domain-specific access models into it before calling Connect.
type Connector interface {
	Connect(ctx context.Context, cfg ConnectorConfig) (Session, error)
}
