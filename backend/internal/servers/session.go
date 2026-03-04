package terminal

import (
	"sync"
	"time"
)

const sessionIdleTimeout = 30 * time.Minute

// sessionRegistry tracks active SSH/Docker sessions and enforces idle timeouts.
// The WebSocket route handler calls Touch on each message received; the
// background janitor calls Close on sessions that have been idle too long.
type sessionRegistry struct {
	mu       sync.Mutex
	sessions map[string]*registeredSession
}

type registeredSession struct {
	id      string
	session Session
	lastMsg time.Time
	done    chan struct{} // closed by Unregister to stop the idle goroutine immediately
}

var registry = &sessionRegistry{
	sessions: make(map[string]*registeredSession),
}

// Register adds a session to the registry and starts idle monitoring.
// The session is automatically closed after sessionIdleTimeout of inactivity.
func Register(id string, sess Session) {
	done := make(chan struct{})
	registry.mu.Lock()
	registry.sessions[id] = &registeredSession{
		id:      id,
		session: sess,
		lastMsg: time.Now(),
		done:    done,
	}
	registry.mu.Unlock()

	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return // Unregister called; exit immediately
			case <-ticker.C:
				registry.mu.Lock()
				rs, ok := registry.sessions[id]
				if !ok {
					registry.mu.Unlock()
					return
				}
				if time.Since(rs.lastMsg) >= sessionIdleTimeout {
					delete(registry.sessions, id)
					registry.mu.Unlock()
					_ = sess.Close()
					return
				}
				registry.mu.Unlock()
			}
		}
	}()
}

// Touch updates the last-activity timestamp for the session, resetting the
// idle timer. Should be called for every message received on the WebSocket.
func Touch(id string) {
	registry.mu.Lock()
	if rs, ok := registry.sessions[id]; ok {
		rs.lastMsg = time.Now()
	}
	registry.mu.Unlock()
}

// Unregister removes the session from the registry (called on WebSocket close).
// It does NOT close the Session itself; the caller is responsible for that.
// The idle-monitoring goroutine is signalled to exit immediately via done.
func Unregister(id string) {
	registry.mu.Lock()
	rs, ok := registry.sessions[id]
	if ok {
		delete(registry.sessions, id)
		close(rs.done)
	}
	registry.mu.Unlock()
}
