package terminal

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"time"

	"github.com/pkg/sftp"
	cryptossh "golang.org/x/crypto/ssh"
)

const sftpMaxUploadBytes = 50 << 20 // 50 MB
const sftpMaxWriteBytes  = 2 << 20  // 2 MB — consistent with the text-read limit

// SFTPClient wraps an SFTP session opened over a dedicated SSH connection.
// It is short-lived: open it, perform one or more operations, then Close.
type SFTPClient struct {
	sshClient  *cryptossh.Client
	sftpClient *sftp.Client
}

// NewSFTPClient dials SSH and opens an SFTP subsystem session.
// The caller must call Close when done.
func NewSFTPClient(ctx context.Context, cfg ConnectorConfig) (*SFTPClient, error) {
	authMethod, err := authMethodFromConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("sftp: auth config: %w", err)
	}

	clientCfg := &cryptossh.ClientConfig{
		User:            cfg.User,
		Auth:            []cryptossh.AuthMethod{authMethod},
		HostKeyCallback: cryptossh.InsecureIgnoreHostKey(), //nolint:gosec
		Timeout:         sshDialTimeout,
	}

	addr := net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", cfg.Port))

	type dialResult struct {
		client *cryptossh.Client
		err    error
	}
	ch := make(chan dialResult, 1)
	go func() {
		cl, err := cryptossh.Dial("tcp", addr, clientCfg)
		ch <- dialResult{cl, err}
	}()

	var sshClient *cryptossh.Client
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-ch:
		if r.err != nil {
			return nil, fmt.Errorf("sftp: dial %s: %w", addr, r.err)
		}
		sshClient = r.client
	}

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		sshClient.Close()
		return nil, fmt.Errorf("sftp: open subsystem: %w", err)
	}

	return &SFTPClient{sshClient: sshClient, sftpClient: sftpClient}, nil
}

// Close releases SFTP and SSH connections.
func (c *SFTPClient) Close() error {
	_ = c.sftpClient.Close()
	return c.sshClient.Close()
}

// DirEntry is a single file or directory entry returned by ListDir.
type DirEntry struct {
	Name       string    `json:"name"`
	Type       string    `json:"type"` // "file" | "dir" | "symlink"
	Size       int64     `json:"size"`
	Mode       string    `json:"mode"`
	ModifiedAt time.Time `json:"modified_at"`
}

// ListDir returns all entries (including dot-files) in the given remote path.
func (c *SFTPClient) ListDir(path string) ([]DirEntry, error) {
	infos, err := c.sftpClient.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("sftp: readdir %q: %w", path, err)
	}

	entries := make([]DirEntry, 0, len(infos))
	for _, fi := range infos {
		t := "file"
		if fi.IsDir() {
			t = "dir"
		} else if fi.Mode()&os.ModeSymlink != 0 {
			t = "symlink"
		}
		entries = append(entries, DirEntry{
			Name:       fi.Name(),
			Type:       t,
			Size:       fi.Size(),
			Mode:       fi.Mode().String(),
			ModifiedAt: fi.ModTime().UTC(),
		})
	}
	return entries, nil
}

// Download streams the remote file to dst (e.g. http.ResponseWriter).
func (c *SFTPClient) Download(remotePath string, dst io.Writer) error {
	f, err := c.sftpClient.Open(remotePath)
	if err != nil {
		return fmt.Errorf("sftp: open %q: %w", remotePath, err)
	}
	defer f.Close()
	_, err = io.Copy(dst, f)
	return err
}

// Upload writes src to remotePath. The total read from src must not exceed
// sftpMaxUploadBytes (50 MB); excess bytes cause an error without data corruption
// because the remote file is only committed on success.
func (c *SFTPClient) Upload(remotePath string, src io.Reader) error {
	limited := io.LimitReader(src, sftpMaxUploadBytes+1)

	f, err := c.sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("sftp: create %q: %w", remotePath, err)
	}
	defer f.Close()

	n, err := io.Copy(f, limited)
	if err != nil {
		_ = c.sftpClient.Remove(remotePath)
		return fmt.Errorf("sftp: write %q: %w", remotePath, err)
	}
	if n > sftpMaxUploadBytes {
		_ = c.sftpClient.Remove(remotePath)
		return fmt.Errorf("sftp: upload exceeds %d bytes limit", sftpMaxUploadBytes)
	}
	return nil
}

// Mkdir creates the directory at path (does not create intermediate directories).
func (c *SFTPClient) Mkdir(path string) error {
	if err := c.sftpClient.Mkdir(path); err != nil {
		return fmt.Errorf("sftp: mkdir %q: %w", path, err)
	}
	return nil
}

// Rename moves/renames from→to.
func (c *SFTPClient) Rename(from, to string) error {
	if err := c.sftpClient.Rename(from, to); err != nil {
		return fmt.Errorf("sftp: rename %q→%q: %w", from, to, err)
	}
	return nil
}

// Delete removes a file or an empty directory. For recursive removal, callers
// must walk the tree themselves (not exposed in MVP).
func (c *SFTPClient) Delete(path string) error {
	fi, err := c.sftpClient.Stat(path)
	if err != nil {
		return fmt.Errorf("sftp: stat %q: %w", path, err)
	}
	if fi.IsDir() {
		if err := c.sftpClient.RemoveDirectory(path); err != nil {
			return fmt.Errorf("sftp: rmdir %q: %w", path, err)
		}
		return nil
	}
	if err := c.sftpClient.Remove(path); err != nil {
		return fmt.Errorf("sftp: remove %q: %w", path, err)
	}
	return nil
}

// ReadFile reads up to maxBytes of a remote file and returns it as a string.
// Returns an error if the file exceeds maxBytes.
func (c *SFTPClient) ReadFile(path string, maxBytes int64) (string, error) {
	f, err := c.sftpClient.Open(path)
	if err != nil {
		return "", fmt.Errorf("sftp: open %q: %w", path, err)
	}
	defer f.Close()

	limited := io.LimitReader(f, maxBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return "", fmt.Errorf("sftp: read %q: %w", path, err)
	}
	if int64(len(data)) > maxBytes {
		return "", fmt.Errorf("sftp: file %q exceeds %d bytes limit", path, maxBytes)
	}
	return string(data), nil
}

// SearchResult is a single match returned by SearchFiles.
type SearchResult struct {
	Path       string    `json:"path"`
	Name       string    `json:"name"`
	Type       string    `json:"type"`
	Size       int64     `json:"size"`
	Mode       string    `json:"mode"`
	ModifiedAt time.Time `json:"modified_at"`
}

const searchMaxResults = 500

// SearchFiles recursively walks basePath and returns entries whose names
// contain query (case-insensitive). Returns at most searchMaxResults results.
func (c *SFTPClient) SearchFiles(basePath, query string) ([]SearchResult, error) {
	q := strings.ToLower(query)
	var results []SearchResult

	walker := c.sftpClient.Walk(basePath)
	for walker.Step() {
		if walker.Err() != nil {
			continue // skip unreadable dirs
		}
		p := walker.Path()
		if p == basePath {
			continue // skip root
		}
		fi := walker.Stat()
		name := fi.Name()
		if !strings.Contains(strings.ToLower(name), q) {
			continue
		}
		t := "file"
		if fi.IsDir() {
			t = "dir"
		} else if fi.Mode()&os.ModeSymlink != 0 {
			t = "symlink"
		}
		results = append(results, SearchResult{
			Path:       p,
			Name:       name,
			Type:       t,
			Size:       fi.Size(),
			Mode:       fi.Mode().String(),
			ModifiedAt: fi.ModTime().UTC(),
		})
		if len(results) >= searchMaxResults {
			break
		}
	}
	return results, nil
}

// WriteFile writes content to a remote file, creating or truncating it.
// Returns an error if content exceeds sftpMaxWriteBytes (2 MB) to match the
// read limit and prevent accidental large writes via the text editor API.
func (c *SFTPClient) WriteFile(path string, content string) error {
	if int64(len(content)) > sftpMaxWriteBytes {
		return fmt.Errorf("sftp: content exceeds %d bytes limit", sftpMaxWriteBytes)
	}
	f, err := c.sftpClient.Create(path)
	if err != nil {
		return fmt.Errorf("sftp: create %q: %w", path, err)
	}
	defer f.Close()

	if _, err := f.Write([]byte(content)); err != nil {
		return fmt.Errorf("sftp: write %q: %w", path, err)
	}
	return nil
}
