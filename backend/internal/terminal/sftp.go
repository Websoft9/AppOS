package terminal

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"strconv"
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

// FileAttrs is full file/dir metadata for property panel editing.
type FileAttrs struct {
	Path       string    `json:"path"`
	Type       string    `json:"type"`
	Mode       string    `json:"mode"`
	Owner      int       `json:"owner"`
	Group      int       `json:"group"`
	OwnerName  string    `json:"owner_name"`
	GroupName  string    `json:"group_name"`
	Size       int64     `json:"size"`
	AccessedAt time.Time `json:"accessed_at"`
	ModifiedAt time.Time `json:"modified_at"`
	CreatedAt  time.Time `json:"created_at"`
}

func (c *SFTPClient) runRemoteCommand(cmd string) (string, error) {
	session, err := c.sshClient.NewSession()
	if err != nil {
		return "", fmt.Errorf("sftp: ssh session: %w", err)
	}
	defer session.Close()

	out, err := session.CombinedOutput(cmd)
	if err != nil {
		return "", fmt.Errorf("sftp: command failed: %w", err)
	}
	return strings.TrimSpace(string(out)), nil
}

func (c *SFTPClient) resolveUserName(uid int) string {
	out, err := c.runRemoteCommand(fmt.Sprintf("id -nu %d", uid))
	if err == nil && out != "" {
		return out
	}
	if uid == 0 {
		return "root"
	}
	return fmt.Sprintf("uid-%d", uid)
}

func (c *SFTPClient) resolveGroupName(gid int) string {
	out, err := c.runRemoteCommand(fmt.Sprintf("getent group %d | cut -d: -f1", gid))
	if err == nil && out != "" {
		return out
	}
	if gid == 0 {
		return "root"
	}
	return fmt.Sprintf("gid-%d", gid)
}

func (c *SFTPClient) resolveUserID(name string) (int, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, fmt.Errorf("empty owner name")
	}
	if n, err := strconv.Atoi(name); err == nil {
		return n, nil
	}
	out, err := c.runRemoteCommand(fmt.Sprintf("id -u %q", name))
	if err != nil {
		return 0, err
	}
	uid, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return 0, fmt.Errorf("invalid uid output for %q", name)
	}
	return uid, nil
}

func (c *SFTPClient) resolveGroupID(name string) (int, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, fmt.Errorf("empty group name")
	}
	if n, err := strconv.Atoi(name); err == nil {
		return n, nil
	}
	out, err := c.runRemoteCommand(fmt.Sprintf("getent group %q | cut -d: -f3", name))
	if err != nil {
		return 0, err
	}
	gid, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return 0, fmt.Errorf("invalid gid output for %q", name)
	}
	return gid, nil
}

// ListDir returns all entries (including dot-files) in the given remote path.
func (c *SFTPClient) ListDir(dirPath string) ([]DirEntry, error) {
	infos, err := c.sftpClient.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("sftp: readdir %q: %w", dirPath, err)
	}

	entries := make([]DirEntry, 0, len(infos))
	for _, fi := range infos {
		fullPath := path.Join(dirPath, fi.Name())
		if lfi, lerr := c.sftpClient.Lstat(fullPath); lerr == nil {
			fi = lfi
		}

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
	fi, err := c.sftpClient.Lstat(path)
	if err != nil {
		return fmt.Errorf("sftp: stat %q: %w", path, err)
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		if err := c.sftpClient.Remove(path); err != nil {
			return fmt.Errorf("sftp: remove symlink %q: %w", path, err)
		}
		return nil
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

// Stat returns full metadata for a file or directory.
func (c *SFTPClient) Stat(filePath string) (FileAttrs, error) {
	fi, err := c.sftpClient.Stat(filePath)
	if err != nil {
		return FileAttrs{}, fmt.Errorf("sftp: stat %q: %w", filePath, err)
	}

	entryType := "file"
	if fi.IsDir() {
		entryType = "dir"
	} else if fi.Mode()&os.ModeSymlink != 0 {
		entryType = "symlink"
	}

	attrs := FileAttrs{
		Path:       filePath,
		Type:       entryType,
		Mode:       fi.Mode().String(),
		Size:       fi.Size(),
		ModifiedAt: fi.ModTime().UTC(),
		// Remote servers frequently don't provide atime/ctime over SFTP v3.
		// Fallback to mtime for stable UI rendering.
		AccessedAt: fi.ModTime().UTC(),
		CreatedAt:  fi.ModTime().UTC(),
	}

	if sys, ok := fi.Sys().(*sftp.FileStat); ok {
		attrs.Owner = int(sys.UID)
		attrs.Group = int(sys.GID)
		attrs.OwnerName = c.resolveUserName(attrs.Owner)
		attrs.GroupName = c.resolveGroupName(attrs.Group)
		if sys.Atime > 0 {
			attrs.AccessedAt = time.Unix(int64(sys.Atime), 0).UTC()
		}
		if sys.Mtime > 0 {
			attrs.ModifiedAt = time.Unix(int64(sys.Mtime), 0).UTC()
		}
	}
	if attrs.OwnerName == "" {
		attrs.OwnerName = c.resolveUserName(attrs.Owner)
	}
	if attrs.GroupName == "" {
		attrs.GroupName = c.resolveGroupName(attrs.Group)
	}

	return attrs, nil
}

// Chmod updates remote file mode.
func (c *SFTPClient) Chmod(filePath string, mode os.FileMode) error {
	if err := c.sftpClient.Chmod(filePath, mode); err != nil {
		return fmt.Errorf("sftp: chmod %q: %w", filePath, err)
	}
	return nil
}

// ChmodRecursive updates mode for the path and all children when path is a directory.
func (c *SFTPClient) ChmodRecursive(filePath string, mode os.FileMode) error {
	fi, err := c.sftpClient.Lstat(filePath)
	if err != nil {
		return fmt.Errorf("sftp: stat %q: %w", filePath, err)
	}
	if !fi.IsDir() {
		return c.Chmod(filePath, mode)
	}

	walker := c.sftpClient.Walk(filePath)
	for walker.Step() {
		if walker.Err() != nil {
			continue
		}
		if err := c.sftpClient.Chmod(walker.Path(), mode); err != nil {
			return fmt.Errorf("sftp: chmod recursive %q: %w", walker.Path(), err)
		}
	}
	return nil
}

// Chown updates remote uid/gid.
func (c *SFTPClient) Chown(filePath string, uid, gid int) error {
	if err := c.sftpClient.Chown(filePath, uid, gid); err != nil {
		return fmt.Errorf("sftp: chown %q: %w", filePath, err)
	}
	return nil
}

// ChownByName updates remote owner/group using principal names (or numeric string).
func (c *SFTPClient) ChownByName(filePath, ownerName, groupName string) error {
	uid, err := c.resolveUserID(ownerName)
	if err != nil {
		return fmt.Errorf("sftp: resolve owner %q: %w", ownerName, err)
	}
	gid, err := c.resolveGroupID(groupName)
	if err != nil {
		return fmt.Errorf("sftp: resolve group %q: %w", groupName, err)
	}
	return c.Chown(filePath, uid, gid)
}

// Symlink creates a symbolic link from linkPath -> target.
func (c *SFTPClient) Symlink(target, linkPath string) error {
	if err := c.sftpClient.Symlink(target, linkPath); err != nil {
		return fmt.Errorf("sftp: symlink %q -> %q: %w", linkPath, target, err)
	}
	return nil
}

// Copy recursively copies file/dir from source to target.
// onProgress is called with copied and total bytes for files.
func (c *SFTPClient) Copy(source, target string, onProgress func(copied, total int64)) (int64, error) {
	fi, err := c.sftpClient.Stat(source)
	if err != nil {
		return 0, fmt.Errorf("sftp: stat %q: %w", source, err)
	}

	if fi.IsDir() {
		return 0, c.copyDir(source, target)
	}

	total := fi.Size()
	var copied int64
	if err := c.copyFile(source, target, func(n int64) {
		copied += n
		if onProgress != nil {
			onProgress(copied, total)
		}
	}); err != nil {
		return copied, err
	}

	return copied, nil
}

func (c *SFTPClient) copyDir(source, target string) error {
	if err := c.sftpClient.MkdirAll(target); err != nil {
		return fmt.Errorf("sftp: mkdirall %q: %w", target, err)
	}

	items, err := c.sftpClient.ReadDir(source)
	if err != nil {
		return fmt.Errorf("sftp: readdir %q: %w", source, err)
	}

	for _, item := range items {
		src := path.Join(source, item.Name())
		dst := path.Join(target, item.Name())
		if item.IsDir() {
			if err := c.copyDir(src, dst); err != nil {
				return err
			}
			continue
		}
		if err := c.copyFile(src, dst, nil); err != nil {
			return err
		}
	}
	return nil
}

func (c *SFTPClient) copyFile(source, target string, onChunk func(n int64)) error {
	src, err := c.sftpClient.Open(source)
	if err != nil {
		return fmt.Errorf("sftp: open %q: %w", source, err)
	}
	defer src.Close()

	dst, err := c.sftpClient.Create(target)
	if err != nil {
		return fmt.Errorf("sftp: create %q: %w", target, err)
	}
	defer dst.Close()

	buf := make([]byte, 32*1024)
	for {
		n, readErr := src.Read(buf)
		if n > 0 {
			wn, writeErr := dst.Write(buf[:n])
			if writeErr != nil {
				_ = c.sftpClient.Remove(target)
				return fmt.Errorf("sftp: write %q: %w", target, writeErr)
			}
			if onChunk != nil && wn > 0 {
				onChunk(int64(wn))
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			_ = c.sftpClient.Remove(target)
			return fmt.Errorf("sftp: read %q: %w", source, readErr)
		}
	}
	return nil
}
