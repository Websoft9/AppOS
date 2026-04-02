package tunnel

import (
	"log"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

type DisconnectReason string

const (
	DisconnectReasonConnectionClosed   DisconnectReason = "connection_closed"
	DisconnectReasonConnectionError    DisconnectReason = "connection_error"
	DisconnectReasonKeepaliveTimeout   DisconnectReason = "keepalive_timeout"
	DisconnectReasonOperatorDisconnect DisconnectReason = "operator_disconnect"
	DisconnectReasonPausedByOperator   DisconnectReason = "paused_by_operator"
	DisconnectReasonTokenRotated       DisconnectReason = "token_rotated"
	DisconnectReasonSessionReplaced    DisconnectReason = "session_replaced"
)

// Session represents an active reverse-SSH tunnel connection from one local server.
type Session struct {
	mu sync.RWMutex
	// ServerID is the PocketBase record ID of the connected server.
	ServerID string
	// Conn is the live SSH server-side connection.
	Conn *ssh.ServerConn
	// Services describes the forwarded port pairs established for this session.
	Services []Service
	// ConnectedAt is the UTC time the session was authenticated and registered.
	ConnectedAt time.Time
	// disconnectReason tracks the best-known classification for the session close.
	disconnectReason DisconnectReason
}

func (s *Session) SetDisconnectReason(reason DisconnectReason) {
	if s == nil || reason == "" {
		return
	}
	s.mu.Lock()
	s.disconnectReason = reason
	s.mu.Unlock()
}

func (s *Session) DisconnectReason() DisconnectReason {
	if s == nil {
		return DisconnectReasonConnectionClosed
	}
	s.mu.RLock()
	reason := s.disconnectReason
	s.mu.RUnlock()
	if reason == "" {
		return DisconnectReasonConnectionClosed
	}
	return reason
}

// Registry is a thread-safe, in-memory store of active tunnel sessions.
// It is keyed by serverID; at most one active session per server is tracked
// (a reconnecting server replaces its previous entry).
type Registry struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewRegistry returns an initialised, empty Registry.
func NewRegistry() *Registry {
	return &Registry{sessions: make(map[string]*Session)}
}

// Register adds or replaces the session for serverID.
// If an existing session is present for the same serverID, its SSH connection
// is closed first (last-writer-wins). This is safe for concurrent use.
func (r *Registry) Register(serverID string, sess *Session) {
	r.mu.Lock()
	if old, ok := r.sessions[serverID]; ok {
		old.SetDisconnectReason(DisconnectReasonSessionReplaced)
		if old.Conn != nil {
			_ = old.Conn.Close()
		}
		log.Printf("[tunnel] kicked old session for server %s (replaced by new connection)", serverID)
	}
	r.sessions[serverID] = sess
	r.mu.Unlock()
}

// Unregister removes the session entry for serverID.
// It is safe to call when no session exists for serverID.
func (r *Registry) Unregister(serverID string) {
	r.mu.Lock()
	delete(r.sessions, serverID)
	r.mu.Unlock()
}

// UnregisterConn removes the session entry for serverID only if the stored
// session's Conn matches the provided connection. This prevents a closing old
// connection from accidentally removing a newer replacement session.
func (r *Registry) UnregisterConn(serverID string, conn *ssh.ServerConn) {
	r.mu.Lock()
	if s, ok := r.sessions[serverID]; ok && s.Conn == conn {
		delete(r.sessions, serverID)
	}
	r.mu.Unlock()
}

// Get returns the Session for serverID, or (nil, false) when not found.
// It is safe for concurrent use.
func (r *Registry) Get(serverID string) (*Session, bool) {
	r.mu.RLock()
	sess, ok := r.sessions[serverID]
	r.mu.RUnlock()
	return sess, ok
}

// Disconnect closes the active SSH connection for serverID.
// It is a no-op when serverID has no active session. The closure triggers the
// handleConn defer in server.go, which calls OnDisconnect and unregisters the
// session — callers need no additional cleanup.
func (r *Registry) Disconnect(serverID string, reason DisconnectReason) {
	r.mu.RLock()
	sess, ok := r.sessions[serverID]
	r.mu.RUnlock()
	if ok && sess.Conn != nil {
		sess.SetDisconnectReason(reason)
		_ = sess.Conn.Close()
	}
}

// All returns a snapshot of all currently registered sessions.
// The returned slice is a copy; the caller may iterate it without holding any lock.
func (r *Registry) All() []*Session {
	r.mu.RLock()
	out := make([]*Session, 0, len(r.sessions))
	for _, s := range r.sessions {
		out = append(out, s)
	}
	r.mu.RUnlock()
	return out
}
