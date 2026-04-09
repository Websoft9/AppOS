package terminal

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

// LocalSession is a PTY-backed local shell session on the AppOS host.
type LocalSession struct {
	cmd  *exec.Cmd
	ptmx *os.File
	mu   sync.Mutex
}

// LocalConnector creates local-host PTY sessions.
type LocalConnector struct{}

// NewLocalSession creates a local shell PTY session.
func NewLocalSession(ctx context.Context, shell string) (*LocalSession, error) {
	if shell == "" {
		shell = "bash"
	}
	cmd := exec.CommandContext(ctx, shell)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return nil, fmt.Errorf("start local PTY: %w", err)
	}

	return &LocalSession{
		cmd:  cmd,
		ptmx: ptmx,
	}, nil
}

// Connect creates a new local shell PTY session.
func (c *LocalConnector) Connect(ctx context.Context, cfg ConnectorConfig) (Session, error) {
	sess, err := NewLocalSession(ctx, cfg.Shell)
	if err != nil {
		return nil, NewConnectError(ErrCatSessionFailed, "failed to start local shell session", err)
	}
	return sess, nil
}

func (s *LocalSession) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ptmx.Write(p)
}

func (s *LocalSession) Read(p []byte) (int, error) {
	return s.ptmx.Read(p)
}

// Close terminates the local session and its subprocess.
func (s *LocalSession) Close() error {
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

var _ Session = (*LocalSession)(nil)
var _ Connector = (*LocalConnector)(nil)
var _ io.Closer = (*LocalSession)(nil)
