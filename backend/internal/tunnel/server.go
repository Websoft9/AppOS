package tunnel

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/time/rate"
)

// TokenValidator resolves a raw token string (the SSH username) to a serverID.
// The implementation lives in routes/tunnel.go and queries PocketBase.
// Returns ("", false) when the token is unknown or revoked.
type TokenValidator interface {
	Validate(token string) (serverID string, ok bool)
}

// SessionHooks receives lifecycle events so the business layer can persist
// state to PocketBase and write audit records without coupling this package
// to PocketBase.
type SessionHooks interface {
	// OnConnect is called immediately after the session is registered.
	// conflicts contains any port reassignments made due to OS conflicts.
	OnConnect(serverID string, services []Service, conflicts []ConflictResolution)
	// OnDisconnect is called when the SSH connection is closed.
	OnDisconnect(serverID string)
}

// defaultRateLimit is the maximum number of new TCP connections accepted per second.
const defaultRateLimit rate.Limit = 10

// defaultMaxPending is the maximum number of concurrent unauthenticated SSH
// handshakes allowed in flight simultaneously.
const defaultMaxPending = 50

// handshakeTimeout is the deadline for the initial SSH handshake + token validation.
// After the session is authenticated the deadline is cleared.
const handshakeTimeout = 15 * time.Second

// keepaliveInterval is how often the server sends an SSH keepalive request to
// the remote end to detect broken connections.
const keepaliveInterval = 30 * time.Second

// keepaliveTimeout is how long the server waits for a response to a keepalive
// request before closing the connection.
const keepaliveTimeout = 15 * time.Second

// hostKeyFile is the filename (within DataDir) that stores the persistent host key.
const hostKeyFile = "tunnel_host_key"

// Server is the reverse-SSH tunnel entry point.  It listens on :2222 and
// accepts connections whose username is a valid tunnel token.
//
// Server is pure infrastructure; it has no knowledge of PocketBase.  All
// business logic is injected via [TokenValidator] and [SessionHooks].
type Server struct {
	// DataDir is the directory (typically pb_data) used to persist the host key.
	DataDir string
	// ListenAddr is the address the server binds to (default ":2222").
	ListenAddr string
	// Validator checks whether an SSH username is a valid tunnel token.
	Validator TokenValidator
	// Pool manages persistent port allocations for tunnel servers.
	Pool *PortPool
	// Sessions is the in-memory session registry.
	Sessions *Registry
	// Hooks receives connect/disconnect events.
	Hooks SessionHooks
	// RateLimit sets the maximum new connections/second (default 10).
	RateLimit rate.Limit
	// MaxPending caps simultaneous unauthenticated handshakes (default 50).
	MaxPending int

	sshCfg  *ssh.ServerConfig
	limiter *rate.Limiter
	sem     chan struct{} // semaphore: slot acquired before handshake
}

// ListenAndServe starts the SSH server.  It blocks until ctx is cancelled.
// The host key is loaded from (or generated into) DataDir/tunnel_host_key.
func (s *Server) ListenAndServe(ctx context.Context) error {
	if err := s.init(); err != nil {
		return fmt.Errorf("tunnel: server init: %w", err)
	}

	addr := s.ListenAddr
	if addr == "" {
		addr = ":2222"
	}

	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("tunnel: listen %s: %w", addr, err)
	}
	log.Printf("[tunnel] listening on %s", addr)

	// Close listener when context is cancelled.
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil // graceful shutdown
			}
			// Transient accept error; keep looping.
			continue
		}

		// Rate limiter — connection-rate gate.
		if !s.limiter.Allow() {
			_ = conn.Close()
			continue
		}

		// Semaphore — concurrent pending handshake gate.
		select {
		case s.sem <- struct{}{}:
		default:
			_ = conn.Close()
			continue
		}

		go func() {
			defer func() { <-s.sem }()
			s.handleConn(conn)
		}()
	}
}

// handleConn performs the SSH handshake, validates the token, and drives the
// tunnel session lifecycle.
func (s *Server) handleConn(conn net.Conn) {
	// Short deadline covers the handshake + token validation only.
	// It is cleared after authentication succeeds so long-lived tunnels work.
	_ = conn.SetDeadline(time.Now().Add(handshakeTimeout))

	sshConn, chans, reqs, err := ssh.NewServerConn(conn, s.sshCfg)
	if err != nil {
		log.Printf("[tunnel] SSH handshake failed from %s: %v", conn.RemoteAddr(), err)
		return // handshake failed; conn already closed by ssh pkg
	}

	// Token validation — must happen before processing any channel or request.
	serverID, ok := s.Validator.Validate(sshConn.User())
	if !ok {
		log.Printf("[tunnel] invalid token from %s (user=%q)", conn.RemoteAddr(), sshConn.User())
		_ = sshConn.Close()
		return
	}

	log.Printf("[tunnel] authenticated server %s from %s", serverID, conn.RemoteAddr())

	// Clear the handshake deadline; the connection may live indefinitely.
	// Liveness is maintained by the keepalive goroutine below.
	_ = conn.SetDeadline(time.Time{})

	// Port allocation.
	services, conflicts := s.Pool.AcquireOrReuse(serverID)
	if services == nil {
		log.Printf("[tunnel] port range exhausted for server %s", serverID)
		_ = sshConn.Close()
		return
	}

	sess := &Session{
		ServerID:    serverID,
		Conn:        sshConn,
		Services:    services,
		ConnectedAt: time.Now().UTC(),
	}
	s.Sessions.Register(serverID, sess)
	s.Hooks.OnConnect(serverID, services, conflicts)

	defer func() {
		s.Sessions.UnregisterConn(serverID, sshConn)
		s.Hooks.OnDisconnect(serverID)
		_ = sshConn.Close()
	}()

	// Discard all incoming channel requests — this is a forward-only tunnel.
	// Channels opened by the client (e.g. session) are rejected; only the
	// server-initiated "forwarded-tcpip" channels are used.
	go func() {
		for newChan := range chans {
			_ = newChan.Reject(ssh.Prohibited, "forward-only tunnel")
		}
	}()

	// Keepalive goroutine: send a request every keepaliveInterval and close the
	// connection if the remote end does not respond within keepaliveTimeout.
	go s.keepalive(sshConn)

	// Start per-service listeners so incoming connections on the tunnel ports
	// can be forwarded back to the client.
	var wg sync.WaitGroup
	stopListeners := make(chan struct{})

	for _, svc := range services {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.runListener(sshConn, svc, stopListeners)
		}()
	}

	// Handle global requests (tcpip-forward, keepalives).  We respond to
	// tcpip-forward with the pre-assigned tunnel port so the OpenSSH client
	// learns which port was picked.
	s.handleGlobalRequests(reqs, services)

	close(stopListeners)
	wg.Wait()
}

// keepalive periodically sends a "keepalive@openssh.com" global request and
// closes the connection if the remote end does not respond within keepaliveTimeout.
// It runs as a goroutine for the lifetime of each authenticated session.
func (s *Server) keepalive(conn *ssh.ServerConn) {
	ticker := time.NewTicker(keepaliveInterval)
	defer ticker.Stop()

	for range ticker.C {
		// SendRequest blocks until a reply or error; guard it with a deadline.
		// We only care that the remote replied at all (proving liveness).
		// OpenSSH replies REQUEST_FAILURE (ok=false) for keepalive requests;
		// that is normal and must NOT be treated as a dead connection.
		ch := make(chan error, 1)
		go func() {
			_, _, err := conn.SendRequest("keepalive@openssh.com", true, nil)
			ch <- err
		}()
		select {
		case err := <-ch:
			if err != nil {
				// Connection is truly broken.
				_ = conn.Close()
				return
			}
			// Reply received (ok or not) — peer is alive.
		case <-time.After(keepaliveTimeout):
			log.Printf("[tunnel] keepalive timeout for server %s — closing", conn.User())
			_ = conn.Close()
			return
		}
	}
}

// handleGlobalRequests processes SSH global requests for one session.
// The only meaningful request type is "tcpip-forward"; all others are rejected.
// Requests arrive in the same order as the -R flags on the autossh command line.
func (s *Server) handleGlobalRequests(reqs <-chan *ssh.Request, services []Service) {
	assignedIdx := 0 // index into services for sequential assignment

	for req := range reqs {
		if req.Type != "tcpip-forward" {
			if req.WantReply {
				_ = req.Reply(false, nil)
			}
			continue
		}

		if assignedIdx >= len(services) {
			// More -R flags than expected services.
			if req.WantReply {
				_ = req.Reply(false, nil)
			}
			continue
		}

		svc := services[assignedIdx]
		assignedIdx++

		if req.WantReply {
			// Reply payload: uint32 chosen port (only when requested port was 0).
			var reply [4]byte
			binary.BigEndian.PutUint32(reply[:], uint32(svc.TunnelPort))
			_ = req.Reply(true, reply[:])
		}
	}
}

// runListener binds 127.0.0.1:<svc.TunnelPort> and for each incoming TCP
// connection opens a "forwarded-tcpip" SSH channel to the remote client,
// then proxies data in both directions.
//
// All proxy goroutines are tracked in a local WaitGroup so that runListener
// does not return (and trigger the session cleanup deferred in handleConn)
// until every in-flight transfer has finished.
func (s *Server) runListener(conn *ssh.ServerConn, svc Service, stop <-chan struct{}) {
	addr := fmt.Sprintf("127.0.0.1:%d", svc.TunnelPort)

	// Retry binding with backoff: when an old session is being kicked the OS
	// may not have released the port yet by the time the new session starts.
	var ln net.Listener
	var err error
	for attempt := range 5 {
		ln, err = net.Listen("tcp", addr)
		if err == nil {
			break
		}
		time.Sleep(time.Duration(25*(attempt+1)) * time.Millisecond)
	}
	if ln == nil {
		log.Printf("[tunnel] cannot bind %s after retries: %v", addr, err)
		return
	}

	go func() {
		<-stop
		_ = ln.Close()
	}()

	var proxyWg sync.WaitGroup
	defer func() {
		_ = ln.Close()
		proxyWg.Wait() // wait for all in-flight transfers before returning
	}()

	for {
		tc, err := ln.Accept()
		if err != nil {
			return // listener closed
		}
		proxyWg.Add(1)
		go func() {
			defer proxyWg.Done()
			defer tc.Close()
			s.forwardConn(conn, svc, tc)
		}()
	}
}

// forwardedTCPPayload is the wire encoding for a "forwarded-tcpip" channel
// open payload (RFC 4254 §7.2).
type forwardedTCPPayload struct {
	Addr       string
	Port       uint32
	OriginAddr string
	OriginPort uint32
}

// forwardConn opens a "forwarded-tcpip" channel on the SSH connection and
// copies data bidirectionally between `tc` and the channel.
func (s *Server) forwardConn(conn *ssh.ServerConn, svc Service, tc net.Conn) {
	originAddr, originPortStr, _ := net.SplitHostPort(tc.RemoteAddr().String())
	originPort := uint32(0)
	fmt.Sscanf(originPortStr, "%d", &originPort)

	payload := ssh.Marshal(forwardedTCPPayload{
		Addr:       "127.0.0.1",
		Port:       uint32(svc.TunnelPort),
		OriginAddr: originAddr,
		OriginPort: originPort,
	})

	ch, reqCh, err := conn.OpenChannel("forwarded-tcpip", payload)
	if err != nil {
		log.Printf("[tunnel] open forwarded-tcpip channel for %s:%d: %v", svc.Name, svc.TunnelPort, err)
		return
	}
	defer ch.Close()
	go ssh.DiscardRequests(reqCh)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); _, _ = io.Copy(ch, tc) }()
	go func() { defer wg.Done(); _, _ = io.Copy(tc, ch) }()
	wg.Wait()
}

// --- initialisation -------------------------------------------------------

func (s *Server) init() error {
	if s.Validator == nil {
		return fmt.Errorf("tunnel: Server.Validator must not be nil")
	}
	if s.Hooks == nil {
		return fmt.Errorf("tunnel: Server.Hooks must not be nil")
	}
	if s.Pool == nil {
		return fmt.Errorf("tunnel: Server.Pool must not be nil")
	}
	if s.Sessions == nil {
		return fmt.Errorf("tunnel: Server.Sessions must not be nil")
	}

	rl := s.RateLimit
	if rl == 0 {
		rl = defaultRateLimit
	}
	s.limiter = rate.NewLimiter(rl, int(rl)+1)

	mp := s.MaxPending
	if mp == 0 {
		mp = defaultMaxPending
	}
	s.sem = make(chan struct{}, mp)

	hostKey, err := s.loadOrGenerateHostKey()
	if err != nil {
		return err
	}

	cfg := &ssh.ServerConfig{
		// NoClientAuth: accept "none" auth — the OpenSSH client uses this as a
		// first attempt and we immediately validate the username as a token.
		NoClientAuth: true,
		// ServerVersion must be a valid SSH banner string.
		ServerVersion: "SSH-2.0-appos-tunnel",
	}
	cfg.AddHostKey(hostKey)
	s.sshCfg = cfg
	return nil
}

// loadOrGenerateHostKey reads the Ed25519 host key from DataDir/tunnel_host_key.
// If the file does not exist, a new key is generated and saved.
func (s *Server) loadOrGenerateHostKey() (ssh.Signer, error) {
	path := filepath.Join(s.DataDir, hostKeyFile)

	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read host key %s: %w", path, err)
	}

	if err == nil {
		// File exists — verify it contains a PEM block before full parsing.
		if b, _ := pem.Decode(data); b == nil {
			return nil, fmt.Errorf("tunnel: host key file %s contains no PEM block", path)
		}
		key, err := ssh.ParseRawPrivateKey(data)
		if err != nil {
			return nil, fmt.Errorf("tunnel: parse host key: %w", err)
		}
		return ssh.NewSignerFromKey(key)
	}

	// Generate a new Ed25519 key.
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("tunnel: generate host key: %w", err)
	}
	_ = pub

	pemBytes, err := encodeEd25519PEM(priv)
	if err != nil {
		return nil, fmt.Errorf("tunnel: encode host key: %w", err)
	}

	if err := os.MkdirAll(s.DataDir, 0o700); err != nil {
		return nil, fmt.Errorf("tunnel: create data dir: %w", err)
	}
	if err := os.WriteFile(path, pemBytes, 0o600); err != nil {
		return nil, fmt.Errorf("tunnel: write host key: %w", err)
	}
	log.Printf("[tunnel] generated new host key at %s", path)

	return ssh.NewSignerFromKey(priv)
}

// encodeEd25519PEM marshals an Ed25519 private key to OpenSSH PEM format.
func encodeEd25519PEM(priv ed25519.PrivateKey) ([]byte, error) {
	key, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		return nil, err
	}
	return pem.EncodeToMemory(key), nil
}
