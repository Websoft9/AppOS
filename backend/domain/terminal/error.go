package terminal

import "fmt"

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
	ErrCatCredentialInvalid ConnectErrorCategory = "credential_invalid" // #nosec G101 -- symbolic error category, not a credential
	// ErrCatSessionFailed — SSH handshake succeeded but PTY/shell setup failed.
	ErrCatSessionFailed ConnectErrorCategory = "session_failed"
	// ErrCatServerDisconnected — server closed the connection unexpectedly.
	ErrCatServerDisconnected ConnectErrorCategory = "server_disconnected"
)

// ConnectError is returned by Connector.Connect: it carries a machine-readable
// category alongside the human-readable message so callers can render
// actionable UI feedback.
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
