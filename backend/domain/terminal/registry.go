package terminal

import (
	"sync"
	"time"
)

const sessionIdleTimeout = 30 * time.Minute
const idleMonitorInterval = time.Minute

// sessionRegistry tracks active terminal sessions and enforces idle timeouts.
// The WebSocket route handler calls Touch on each message received; the
// background janitor calls Close on sessions that have been idle too long.
type sessionRegistry struct {
	mu             sync.Mutex
	sessions       map[string]*registeredSession
	monitorStopCh  chan struct{}
	monitorDoneCh  chan struct{}
	monitorRunning bool
}

type registeredSession struct {
	id      string
	session Session
	lastMsg time.Time
}

var registry = &sessionRegistry{
	sessions: make(map[string]*registeredSession),
}

// StartIdleMonitor starts the background idle-session janitor.
// Safe to call multiple times.
func StartIdleMonitor() {
	registry.mu.Lock()
	if registry.monitorRunning {
		registry.mu.Unlock()
		return
	}
	stopCh := make(chan struct{})
	doneCh := make(chan struct{})
	registry.monitorStopCh = stopCh
	registry.monitorDoneCh = doneCh
	registry.monitorRunning = true
	registry.mu.Unlock()

	go func() {
		ticker := time.NewTicker(idleMonitorInterval)
		defer ticker.Stop()
		defer close(doneCh)

		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				registry.closeExpiredSessions(time.Now())
			}
		}
	}()
}

// StopIdleMonitor stops the background idle-session janitor and closes all
// currently tracked sessions. Safe to call multiple times.
func StopIdleMonitor() {
	registry.mu.Lock()
	if !registry.monitorRunning {
		registry.mu.Unlock()
		return
	}
	stopCh := registry.monitorStopCh
	doneCh := registry.monitorDoneCh
	registry.monitorStopCh = nil
	registry.monitorDoneCh = nil
	registry.monitorRunning = false
	registry.mu.Unlock()

	close(stopCh)
	<-doneCh

	registry.closeAllSessions()
}

func (r *sessionRegistry) closeExpiredSessions(now time.Time) {
	r.mu.Lock()
	toClose := make([]Session, 0)
	for id, rs := range r.sessions {
		if now.Sub(rs.lastMsg) >= sessionIdleTimeout {
			delete(r.sessions, id)
			toClose = append(toClose, rs.session)
		}
	}
	r.mu.Unlock()

	for _, sess := range toClose {
		_ = sess.Close()
	}
}

func (r *sessionRegistry) closeAllSessions() {
	r.mu.Lock()
	toClose := make([]Session, 0, len(r.sessions))
	for id, rs := range r.sessions {
		delete(r.sessions, id)
		toClose = append(toClose, rs.session)
	}
	r.mu.Unlock()

	for _, sess := range toClose {
		_ = sess.Close()
	}
}

// Register adds a session to the registry. The session is automatically closed
// after sessionIdleTimeout of inactivity.
func Register(id string, sess Session) {
	registry.mu.Lock()
	registry.sessions[id] = &registeredSession{
		id:      id,
		session: sess,
		lastMsg: time.Now(),
	}
	registry.mu.Unlock()
}

// Touch updates the last-activity timestamp, resetting the idle timer.
// Should be called for every message received on the WebSocket.
func Touch(id string) {
	registry.mu.Lock()
	if rs, ok := registry.sessions[id]; ok {
		rs.lastMsg = time.Now()
	}
	registry.mu.Unlock()
}

// Unregister removes the session from the registry (called on WebSocket close).
// It does NOT close the Session itself; the caller is responsible for that.
func Unregister(id string) {
	registry.mu.Lock()
	if _, ok := registry.sessions[id]; ok {
		delete(registry.sessions, id)
	}
	registry.mu.Unlock()
}
