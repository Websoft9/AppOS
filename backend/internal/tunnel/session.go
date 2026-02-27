package tunnel

import (
	"log"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Session represents an active reverse-SSH tunnel connection from one local server.
type Session struct {
	// ServerID is the PocketBase record ID of the connected server.
	ServerID string
	// Conn is the live SSH server-side connection.
	Conn *ssh.ServerConn
	// Services describes the forwarded port pairs established for this session.
	Services []Service
	// ConnectedAt is the UTC time the session was authenticated and registered.
	ConnectedAt time.Time
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
	if old, ok := r.sessions[serverID]; ok && old.Conn != nil {
		_ = old.Conn.Close()
		log.Printf("[tunnel] kicked old session for server %s (replaced by new connection)", serverID)
	}
	r.sessions[serverID] = sess
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
func (r *Registry) Disconnect(serverID string) {
	r.mu.RLock()
	sess, ok := r.sessions[serverID]
	r.mu.RUnlock()
	if ok && sess.Conn != nil {
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
