// Package terminal provides WebSocket-based terminal (PTY) support.
//
// Connectors:
//   - LocalSession  — local bash PTY (system terminal, Epic 1)
//   - SSHConnector  — SSH PTY for registered servers (Epic 15)
//   - SFTPConnector — REST file operations over SSH (Epic 15)
package terminal

import (
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

// LocalSession is a PTY-backed local bash session bridged with a WebSocket.
// Used by the system terminal route (/api/ext/system/terminal).
type LocalSession struct {
	cmd  *exec.Cmd
	ptmx *os.File
	conn *websocket.Conn
	mu   sync.Mutex
}

// NewLocalSession creates a local bash PTY session and bridges it with a WebSocket.
func NewLocalSession(conn *websocket.Conn) (*LocalSession, error) {
	cmd := exec.Command("bash")
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, err
	}

	s := &LocalSession{
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

// Close terminates the local session and its subprocess.
func (s *LocalSession) Close() error {
	_ = s.conn.Close()
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	err := s.ptmx.Close()
	_ = s.cmd.Wait()
	return err
}

// Resize changes the PTY window size.
func (s *LocalSession) Resize(rows, cols uint16) error {
	return pty.Setsize(s.ptmx, &pty.Winsize{
		Rows: rows,
		Cols: cols,
	})
}

// ensure io interface
var _ io.Closer = (*LocalSession)(nil)
