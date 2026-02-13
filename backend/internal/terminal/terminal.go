// Package terminal provides WebSocket-based terminal (PTY) support.
//
// Used by the system terminal route to create interactive shell sessions
// via xterm.js on the frontend and creack/pty on the backend.
package terminal

import (
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

// Session represents an active terminal session.
type Session struct {
	cmd  *exec.Cmd
	ptmx *os.File
	conn *websocket.Conn
	mu   sync.Mutex
}

// NewSession creates a PTY-backed terminal session and bridges it with a WebSocket.
func NewSession(conn *websocket.Conn) (*Session, error) {
	cmd := exec.Command("bash")
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}

	s := &Session{
		cmd:  cmd,
		ptmx: ptmx,
		conn: conn,
	}

	// PTY → WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				break
			}
			s.mu.Lock()
			_ = conn.WriteMessage(websocket.BinaryMessage, buf[:n])
			s.mu.Unlock()
		}
	}()

	// WebSocket → PTY
	go func() {
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}
			_, _ = ptmx.Write(msg)
		}
	}()

	return s, nil
}

// Close terminates the terminal session and its subprocess.
func (s *Session) Close() error {
	_ = s.conn.Close()
	// Kill the subprocess to avoid orphaned processes
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	err := s.ptmx.Close()
	// Wait for the process to release resources
	_ = s.cmd.Wait()
	return err
}

// Resize changes the PTY window size.
func (s *Session) Resize(rows, cols uint16) error {
	return pty.Setsize(s.ptmx, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
}

// ensure io interfaces
var _ io.Closer = (*Session)(nil)
