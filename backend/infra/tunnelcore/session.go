package tunnelcore

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

// Session represents an active reverse-SSH tunnel connection from one remote client.
type Session struct {
	mu sync.RWMutex
	// ClientID identifies the connected remote node inside the caller's system.
	ClientID string
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
// It is keyed by clientID; at most one active session per client is tracked
// (a reconnecting client replaces its previous entry).
type Registry struct {
	mu       sync.RWMutex
	sessions map[string]*Session
}

// NewRegistry returns an initialised, empty Registry.
func NewRegistry() *Registry {
	return &Registry{sessions: make(map[string]*Session)}
}

// Register adds or replaces the session for clientID.
// If an existing session is present for the same clientID, its SSH connection
// is closed first (last-writer-wins). This is safe for concurrent use.
func (r *Registry) Register(clientID string, sess *Session) {
	r.mu.Lock()
	if old, ok := r.sessions[clientID]; ok {
		old.SetDisconnectReason(DisconnectReasonSessionReplaced)
		if old.Conn != nil {
			_ = old.Conn.Close()
		}
		log.Printf("[tunnel] kicked old session for client %s (replaced by new connection)", clientID)
	}
	r.sessions[clientID] = sess
	r.mu.Unlock()
}

// Unregister removes the session entry for clientID.
// It is safe to call when no session exists for clientID.
func (r *Registry) Unregister(clientID string) {
	r.mu.Lock()
	delete(r.sessions, clientID)
	r.mu.Unlock()
}

// UnregisterConn removes the session entry for clientID only if the stored
// session's Conn matches the provided connection. This prevents a closing old
// connection from accidentally removing a newer replacement session.
func (r *Registry) UnregisterConn(clientID string, conn *ssh.ServerConn) {
	r.mu.Lock()
	if s, ok := r.sessions[clientID]; ok && s.Conn == conn {
		delete(r.sessions, clientID)
	}
	r.mu.Unlock()
}

// Get returns the Session for clientID, or (nil, false) when not found.
// It is safe for concurrent use.
func (r *Registry) Get(clientID string) (*Session, bool) {
	r.mu.RLock()
	sess, ok := r.sessions[clientID]
	r.mu.RUnlock()
	return sess, ok
}

// Disconnect closes the active SSH connection for clientID.
// It is a no-op when clientID has no active session. The closure triggers the
// handleConn defer in server.go, which calls OnDisconnect and unregisters the
// session — callers need no additional cleanup.
func (r *Registry) Disconnect(clientID string, reason DisconnectReason) {
	r.mu.RLock()
	sess, ok := r.sessions[clientID]
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
