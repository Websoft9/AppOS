package terminal

import (
	"fmt"
	"github.com/gorilla/websocket"
	"slices"
	"sync"
	"time"
)

const sessionIdleTimeout = 30 * time.Minute
const idleMonitorInterval = time.Minute
const sessionReplayBufferLimit = 256 * 1024

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
	id           string
	session      Session
	userID       string
	resourceType string
	resourceID   string
	sessionType  string
	startedAt    time.Time
	lastMsg      time.Time
	state        string
	attachedConn *websocket.Conn
	workspace    TerminalWorkspaceSnapshot
	outputBuffer []byte
	writeMu      sync.Mutex
}

type SessionSummary struct {
	ID           string                    `json:"id"`
	UserID       string                    `json:"user_id"`
	ResourceType string                    `json:"resource_type"`
	ResourceID   string                    `json:"resource_id"`
	SessionType  string                    `json:"session_type"`
	State        string                    `json:"state"`
	StartedAt    time.Time                 `json:"started_at"`
	LastActiveAt time.Time                 `json:"last_active_at"`
	Workspace    TerminalWorkspaceSnapshot `json:"workspace"`
}

type TerminalWorkspaceSnapshot struct {
	ActiveServerID string   `json:"active_server_id,omitempty"`
	SidePanel      string   `json:"side_panel,omitempty"`
	FilePath       string   `json:"file_path,omitempty"`
	LockedRoot     string   `json:"locked_root,omitempty"`
	SplitRatio     *float64 `json:"split_ratio,omitempty"`
}

const (
	SessionStateAttached = "attached"
	SessionStateDetached = "detached"
)

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
	RegisterDetailed(id, sess, "", "", "", "")
}

// RegisterDetailed adds a session plus metadata to the registry.
// The session is automatically closed after sessionIdleTimeout of inactivity.
func RegisterDetailed(
	id string,
	sess Session,
	userID string,
	resourceType string,
	resourceID string,
	sessionType string,
) {
	now := time.Now()
	registry.mu.Lock()
	registry.sessions[id] = &registeredSession{
		id:           id,
		session:      sess,
		userID:       userID,
		resourceType: resourceType,
		resourceID:   resourceID,
		sessionType:  sessionType,
		startedAt:    now,
		lastMsg:      now,
		state:        SessionStateAttached,
	}
	registry.mu.Unlock()
}

// RegisterResumableDetailed adds a session plus metadata and starts a background
// read loop so the session can survive temporary websocket detaches.
func RegisterResumableDetailed(
	id string,
	sess Session,
	userID string,
	resourceType string,
	resourceID string,
	sessionType string,
) {
	RegisterDetailed(id, sess, userID, resourceType, resourceID, sessionType)
	registry.mu.Lock()
	rs := registry.sessions[id]
	registry.mu.Unlock()
	if rs != nil {
		go registry.streamSessionOutput(rs)
	}
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
	delete(registry.sessions, id)
	registry.mu.Unlock()
}

// UpdateWorkspace updates the stored workspace snapshot for a session owned by the given user.
func UpdateWorkspace(id string, userID string, snapshot TerminalWorkspaceSnapshot) error {
	registry.mu.Lock()
	defer registry.mu.Unlock()

	rs, ok := registry.sessions[id]
	if !ok {
		return fmt.Errorf("terminal session not found")
	}
	if rs.userID != userID {
		return fmt.Errorf("terminal session is not available for this user")
	}
	rs.workspace = snapshot
	return nil
}

// Detach keeps the session alive but removes any currently attached websocket.
func Detach(id string) {
	registry.mu.Lock()
	if rs, ok := registry.sessions[id]; ok {
		rs.attachedConn = nil
		rs.state = SessionStateDetached
	}
	registry.mu.Unlock()
}

// Close removes the session from the registry and closes the underlying terminal session.
func Close(id string) {
	registry.mu.Lock()
	rs, ok := registry.sessions[id]
	if ok {
		delete(registry.sessions, id)
	}
	registry.mu.Unlock()
	if ok {
		_ = rs.session.Close()
	}
}

// CloseOwned removes and closes a session only when it belongs to the given user.
func CloseOwned(id string, userID string) error {
	registry.mu.Lock()
	rs, ok := registry.sessions[id]
	if !ok {
		registry.mu.Unlock()
		return fmt.Errorf("terminal session not found")
	}
	if rs.userID != userID {
		registry.mu.Unlock()
		return fmt.Errorf("terminal session is not available for this user")
	}
	delete(registry.sessions, id)
	registry.mu.Unlock()

	_ = rs.session.Close()
	return nil
}

// FindResumableForAttach validates that an existing resumable session can be attached.
func FindResumableForAttach(
	id string,
	userID string,
	resourceType string,
	resourceID string,
	sessionType string,
) (Session, error) {
	registry.mu.Lock()
	defer registry.mu.Unlock()

	rs, ok := registry.sessions[id]
	if !ok {
		return nil, fmt.Errorf("terminal session not found")
	}
	if rs.userID != userID || rs.resourceType != resourceType || rs.resourceID != resourceID || rs.sessionType != sessionType {
		return nil, fmt.Errorf("terminal session is not available for this resource")
	}
	if rs.attachedConn != nil {
		return nil, fmt.Errorf("terminal session is already attached elsewhere")
	}
	return rs.session, nil
}

// AttachResumable binds an existing resumable session to a websocket connection.
func AttachResumable(
	id string,
	userID string,
	resourceType string,
	resourceID string,
	sessionType string,
	conn *websocket.Conn,
) error {
	var (
		rs     *registeredSession
		replay []byte
	)
	registry.mu.Lock()

	current, ok := registry.sessions[id]
	if !ok {
		registry.mu.Unlock()
		return fmt.Errorf("terminal session not found")
	}
	if current.userID != userID || current.resourceType != resourceType || current.resourceID != resourceID || current.sessionType != sessionType {
		registry.mu.Unlock()
		return fmt.Errorf("terminal session is not available for this resource")
	}
	if current.attachedConn != nil {
		registry.mu.Unlock()
		return fmt.Errorf("terminal session is already attached elsewhere")
	}
	current.attachedConn = conn
	current.state = SessionStateAttached
	current.lastMsg = time.Now()
	rs = current
	replay = append([]byte(nil), current.outputBuffer...)
	registry.mu.Unlock()

	if len(replay) > 0 {
		rs.writeMu.Lock()
		err := conn.WriteMessage(websocket.BinaryMessage, replay)
		rs.writeMu.Unlock()
		if err != nil {
			registry.mu.Lock()
			if latest, ok := registry.sessions[id]; ok && latest == rs && rs.attachedConn == conn {
				rs.attachedConn = nil
				rs.state = SessionStateDetached
			}
			registry.mu.Unlock()
			return err
		}
	}

	return nil
}

func appendReplayBuffer(existing []byte, payload []byte) []byte {
	if len(payload) >= sessionReplayBufferLimit {
		return append([]byte(nil), payload[len(payload)-sessionReplayBufferLimit:]...)
	}
	combinedLen := len(existing) + len(payload)
	if combinedLen <= sessionReplayBufferLimit {
		return append(existing, payload...)
	}
	trim := combinedLen - sessionReplayBufferLimit
	if trim >= len(existing) {
		return append([]byte(nil), payload[len(payload)-sessionReplayBufferLimit:]...)
	}
	next := append([]byte(nil), existing[trim:]...)
	return append(next, payload...)
}

func (r *sessionRegistry) streamSessionOutput(rs *registeredSession) {
	buf := make([]byte, 4096)
	for {
		n, err := rs.session.Read(buf)
		if err != nil {
			r.mu.Lock()
			current, ok := r.sessions[rs.id]
			if ok && current == rs {
				delete(r.sessions, rs.id)
			}
			conn := rs.attachedConn
			rs.attachedConn = nil
			r.mu.Unlock()
			if conn != nil {
				_ = conn.WriteControl(
					websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, "session ended"),
					time.Now().Add(2*time.Second),
				)
				_ = conn.Close()
			}
			_ = rs.session.Close()
			return
		}
		if n <= 0 {
			continue
		}
		payload := append([]byte(nil), buf[:n]...)
		var conn *websocket.Conn
		r.mu.Lock()
		current, ok := r.sessions[rs.id]
		if !ok || current != rs {
			r.mu.Unlock()
			return
		}
		rs.outputBuffer = appendReplayBuffer(rs.outputBuffer, payload)
		conn = rs.attachedConn
		r.mu.Unlock()
		if conn == nil {
			continue
		}
		rs.writeMu.Lock()
		err = conn.WriteMessage(websocket.BinaryMessage, payload)
		rs.writeMu.Unlock()
		if err != nil {
			r.mu.Lock()
			if current, ok := r.sessions[rs.id]; ok && current == rs && rs.attachedConn == conn {
				rs.attachedConn = nil
				rs.state = SessionStateDetached
			}
			r.mu.Unlock()
		}
	}
}

// ListSummariesByUser returns active session summaries for the given user,
// ordered by most recent activity first.
func ListSummariesByUser(userID string) []SessionSummary {
	registry.mu.Lock()
	defer registry.mu.Unlock()

	summaries := make([]SessionSummary, 0, len(registry.sessions))
	for _, rs := range registry.sessions {
		if rs.userID != "" && rs.userID != userID {
			continue
		}
		summaries = append(summaries, SessionSummary{
			ID:           rs.id,
			UserID:       rs.userID,
			ResourceType: rs.resourceType,
			ResourceID:   rs.resourceID,
			SessionType:  rs.sessionType,
			State:        rs.state,
			StartedAt:    rs.startedAt,
			LastActiveAt: rs.lastMsg,
			Workspace:    rs.workspace,
		})
	}

	slices.SortFunc(summaries, func(a, b SessionSummary) int {
		if a.LastActiveAt.Equal(b.LastActiveAt) {
			return 0
		}
		if a.LastActiveAt.After(b.LastActiveAt) {
			return -1
		}
		return 1
	})

	return summaries
}
