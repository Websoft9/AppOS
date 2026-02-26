package terminal

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
)

const (
	defaultDockerSocket = "/var/run/docker.sock"
	defaultDockerShell  = "/bin/sh"
)

// DockerExecConnector implements Session by creating a Docker exec
// instance with a TTY and hijacking the connection for bidirectional I/O.
type DockerExecConnector struct{}

// dockerExecSession wraps a hijacked Docker exec connection.
type dockerExecSession struct {
	conn   net.Conn
	execID string
	mu     sync.Mutex
}

// bufferedConn wraps a net.Conn and routes reads through a bufio.Reader.
// This preserves any bytes that http.ReadResponse already consumed from the
// underlying connection into the bufio buffer during HTTP header parsing.
type bufferedConn struct {
	net.Conn
	r *bufio.Reader
}

func (b *bufferedConn) Read(p []byte) (int, error) {
	return b.r.Read(p)
}

// Connect creates a Docker exec session for the given container.
// cfg.Host is the containerID (name or ID); cfg.Shell overrides the shell.
// Connect respects context cancellation.
func (c *DockerExecConnector) Connect(ctx context.Context, cfg ConnectorConfig) (Session, error) {
	containerID := cfg.Host
	shell := cfg.Shell
	if shell == "" {
		shell = defaultDockerShell
	}

	type result struct {
		sess Session
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		execID, err := dockerCreateExec(containerID, shell)
		if err != nil {
			ch <- result{nil, fmt.Errorf("docker exec create: %w", err)}
			return
		}
		conn, err := dockerStartExec(execID)
		if err != nil {
			ch <- result{nil, fmt.Errorf("docker exec start: %w", err)}
			return
		}
		ch <- result{&dockerExecSession{conn: conn, execID: execID}, nil}
	}()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-ch:
		return r.sess, r.err
	}
}

func (s *dockerExecSession) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conn.Write(p)
}

func (s *dockerExecSession) Read(p []byte) (int, error) {
	return s.conn.Read(p)
}

func (s *dockerExecSession) Resize(rows, cols uint16) error {
	return dockerResizeExec(s.execID, rows, cols)
}

func (s *dockerExecSession) Close() error {
	return s.conn.Close()
}

// ─── Docker Engine API helpers (unix socket) ────────────────────────────────

func dockerDial() (net.Conn, error) {
	return net.Dial("unix", defaultDockerSocket)
}

// dockerAPIRequest sends an HTTP request to the Docker daemon via unix socket
// and returns the parsed response. Caller must close resp.Body.
func dockerAPIRequest(method, path string, body string) (*http.Response, error) {
	conn, err := dockerDial()
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(method, "http://localhost"+path, strings.NewReader(body))
	if err != nil {
		conn.Close()
		return nil, err
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	if err := req.Write(conn); err != nil {
		conn.Close()
		return nil, err
	}

	resp, err := http.ReadResponse(bufio.NewReader(conn), req)
	if err != nil {
		conn.Close()
		return nil, err
	}

	// Wrap the response body to close the connection when done
	resp.Body = &connClosingReader{ReadCloser: resp.Body, conn: conn}
	return resp, nil
}

// connClosingReader closes the underlying connection when the body is closed.
type connClosingReader struct {
	io.ReadCloser
	conn net.Conn
}

func (r *connClosingReader) Close() error {
	r.ReadCloser.Close()
	return r.conn.Close()
}

// dockerCreateExec creates an exec instance and returns the exec ID.
func dockerCreateExec(containerID, shell string) (string, error) {
	body := fmt.Sprintf(`{"AttachStdin":true,"AttachStdout":true,"AttachStderr":true,"Tty":true,"Cmd":[%q]}`, shell)

	resp, err := dockerAPIRequest("POST", fmt.Sprintf("/containers/%s/exec", containerID), body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("exec create failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		ID string `json:"Id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode exec response: %w", err)
	}
	return result.ID, nil
}

// dockerStartExec starts the exec and returns the hijacked raw connection.
// The caller owns the connection and must close it.
func dockerStartExec(execID string) (net.Conn, error) {
	conn, err := dockerDial()
	if err != nil {
		return nil, err
	}

	req, _ := http.NewRequest("POST", "http://localhost"+fmt.Sprintf("/exec/%s/start", execID), strings.NewReader(`{"Detach":false,"Tty":true}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connection", "Upgrade")
	req.Header.Set("Upgrade", "tcp")

	if err := req.Write(conn); err != nil {
		conn.Close()
		return nil, err
	}

	// Read HTTP response through a named bufio.Reader so we can hand it off
	// wrapped in a bufferedConn — any bytes beyond the HTTP headers that
	// were pre-read into the buffer are preserved for subsequent Read calls.
	br := bufio.NewReader(conn)
	resp, err := http.ReadResponse(br, req)
	if err != nil {
		conn.Close()
		return nil, err
	}

	// Accept both 101 (Switching Protocols) and 200 (OK with Content-Type: application/vnd.docker.raw-stream)
	if resp.StatusCode != http.StatusSwitchingProtocols && resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		conn.Close()
		return nil, fmt.Errorf("exec start failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	// Connection is now hijacked — wrap with bufferedConn to avoid losing
	// bytes already pre-read by the bufio.Reader during header parsing.
	return &bufferedConn{Conn: conn, r: br}, nil
}

// dockerResizeExec resizes the TTY of a running exec instance.
func dockerResizeExec(execID string, rows, cols uint16) error {
	path := fmt.Sprintf("/exec/%s/resize?h=%d&w=%d", execID, rows, cols)
	resp, err := dockerAPIRequest("POST", path, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("resize failed: status %d", resp.StatusCode)
	}
	return nil
}
