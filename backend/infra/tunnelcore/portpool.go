package tunnelcore

import (
	"fmt"
	"net"
	"sync"
)

// Service describes one forwarded port pair established through the tunnel.
type Service struct {
	// Name identifies the forwarded service, e.g. "ssh" or "http".
	Name string `json:"service_name"`
	// LocalPort is the port on the local (NAT-behind) server, e.g. 22 or 80.
	LocalPort int `json:"local_port"`
	// TunnelPort is the port bound on appos 127.0.0.1, e.g. 42001.
	TunnelPort int `json:"tunnel_port"`
}

// ForwardSpec describes a desired tunnel forward before appos assigns a tunnel port.
type ForwardSpec struct {
	Name string `json:"service_name"`
	// LocalPort is the port on the local tunnel server to be exposed through appos.
	LocalPort int `json:"local_port"`
}

// ConflictResolution records a forced port reassignment that occurred because
// a previously stored port was already in use by another OS process at startup.
// The caller (routes/tunnel.go) must update the DB record and write an audit entry.
type ConflictResolution struct {
	// ServiceName identifies which service's port was replaced.
	ServiceName string
	// OldPort is the port that was previously stored but found occupied.
	OldPort int
	// NewPort is the freshly allocated replacement port.
	NewPort int
}

// PortRecord carries the persisted service assignments for one client.
// It is populated from the DB tunnel_services field at startup.
type PortRecord struct {
	// ClientID identifies the remote node inside the caller's system.
	ClientID string
	// Services lists each forwarded service with its stored tunnel port.
	Services []Service
}

var defaultForwardSpecs = []ForwardSpec{
	{Name: "ssh", LocalPort: 22},
	{Name: "http", LocalPort: 80},
}

// DefaultForwardSpecs returns the fallback desired forwards for tunnel servers.
func DefaultForwardSpecs() []ForwardSpec {
	out := make([]ForwardSpec, len(defaultForwardSpecs))
	copy(out, defaultForwardSpecs)
	return out
}

// PortPool manages persistent port assignments for tunnel clients.
// It is concurrency-safe.
//
// Port lifecycle:
//   - LoadExisting pre-reserves all previously-assigned ports at startup.
//   - AcquireOrReuse hands out ports to a connecting client.
//   - Release returns ports to the free pool when a client is deleted.
type PortPool struct {
	mu    sync.Mutex
	start int
	end   int
	// byClient maps clientID → assigned services (preserved across reconnects).
	byClient map[string][]Service
	// byPort maps tunnel port → owning clientID (reverse index for conflict detection).
	byPort map[int]string
}

// NewPortPool creates a PortPool covering [start, end] (inclusive).
// Callers must call LoadExisting before AcquireOrReuse.
func NewPortPool(start, end int) *PortPool {
	return &PortPool{
		start:    start,
		end:      end,
		byClient: make(map[string][]Service),
		byPort:   make(map[int]string),
	}
}

// LoadExisting pre-reserves ports from previously stored DB records so they
// are never reassigned to a different server.  This must be called once at
// appos startup before the SSH listener is opened.
//
// Ports that appear in multiple records (data inconsistency) are skipped with
// a log-friendly error — the second server will get fresh ports on reconnect.
func (p *PortPool) LoadExisting(records []PortRecord) {
	p.mu.Lock()
	defer p.mu.Unlock()

	for _, rec := range records {
		for _, svc := range rec.Services {
			if existing, conflict := p.byPort[svc.TunnelPort]; conflict {
				// Data inconsistency: two servers claim the same port.
				// Skip silently; the second server will reallocate on connect.
				_ = existing
				continue
			}
			p.byPort[svc.TunnelPort] = rec.ClientID
		}
		p.byClient[rec.ClientID] = rec.Services
	}
}

// AcquireOrReuse returns the service-to-port mapping for clientID.
//
//   - Known client: returns the stored services, checking each port for OS-level
//     conflicts. Conflicted ports are replaced from the free range; a
//     ConflictResolution is returned for each replacement so the caller can
//     update the DB and write an audit entry.
//   - New client: allocates one port per desired forward and stores them.
//
// Returns (nil, nil) only when the port range is exhausted — the caller must
// reject the connection.
func (p *PortPool) AcquireOrReuse(clientID string, desired []ForwardSpec) ([]Service, []ConflictResolution) {
	p.mu.Lock()
	defer p.mu.Unlock()
	desired = normalizeForwardSpecs(desired)

	if svcs, known := p.byClient[clientID]; known {
		return p.reuseServices(clientID, svcs, desired)
	}
	return p.allocateNew(clientID, desired)
}

// Release frees all ports assigned to clientID so they can be given to new clients.
// It is a no-op when clientID has no reservation.
func (p *PortPool) Release(clientID string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	svcs, ok := p.byClient[clientID]
	if !ok {
		return
	}
	for _, svc := range svcs {
		delete(p.byPort, svc.TunnelPort)
	}
	delete(p.byClient, clientID)
}

// --- internal helpers (caller must hold p.mu) ----------------------------

// reuseServices reconciles previous effective services with the current desired
// forwards, reusing prior tunnel ports when possible and allocating new ones only
// for conflicts or newly-added forwards.
func (p *PortPool) reuseServices(clientID string, prev []Service, desired []ForwardSpec) ([]Service, []ConflictResolution) {
	var (
		updated   = make([]Service, 0, len(desired))
		conflicts []ConflictResolution
	)
	workingByPort := clonePortOwners(p.byPort)
	prevByName := make(map[string]Service, len(prev))
	desiredNames := make(map[string]struct{}, len(desired))

	for _, svc := range prev {
		prevByName[svc.Name] = svc
	}
	for _, spec := range desired {
		desiredNames[spec.Name] = struct{}{}
	}
	for _, svc := range prev {
		if _, keep := desiredNames[svc.Name]; !keep {
			delete(workingByPort, svc.TunnelPort)
		}
	}

	for _, spec := range desired {
		if existing, ok := prevByName[spec.Name]; ok {
			if portFree(existing.TunnelPort) {
				updated = append(updated, Service{
					Name:       spec.Name,
					LocalPort:  spec.LocalPort,
					TunnelPort: existing.TunnelPort,
				})
				continue
			}

			newPort, ok := p.allocatePortFromOwners(workingByPort)
			if !ok {
				return nil, nil
			}

			conflicts = append(conflicts, ConflictResolution{
				ServiceName: spec.Name,
				OldPort:     existing.TunnelPort,
				NewPort:     newPort,
			})

			delete(workingByPort, existing.TunnelPort)
			workingByPort[newPort] = clientID
			updated = append(updated, Service{
				Name:       spec.Name,
				LocalPort:  spec.LocalPort,
				TunnelPort: newPort,
			})
			continue
		}

		newPort, ok := p.allocatePortFromOwners(workingByPort)
		if !ok {
			return nil, nil
		}
		workingByPort[newPort] = clientID
		updated = append(updated, Service{
			Name:       spec.Name,
			LocalPort:  spec.LocalPort,
			TunnelPort: newPort,
		})
	}

	p.byPort = workingByPort
	p.byClient[clientID] = updated
	return updated, conflicts
}

// allocateNew assigns ports for all desired forward specs to a first-time client.
func (p *PortPool) allocateNew(clientID string, desired []ForwardSpec) ([]Service, []ConflictResolution) {
	workingByPort := clonePortOwners(p.byPort)
	svcs := make([]Service, 0, len(desired))

	for _, spec := range desired {
		port, ok := p.allocatePortFromOwners(workingByPort)
		if !ok {
			return nil, nil
		}
		workingByPort[port] = clientID
		svcs = append(svcs, Service{
			Name:       spec.Name,
			LocalPort:  spec.LocalPort,
			TunnelPort: port,
		})
	}

	p.byPort = workingByPort
	p.byClient[clientID] = svcs
	return svcs, nil
}

// allocatePort finds the next free port in [start, end] that is neither reserved
// by another server nor occupied by an OS process.  Returns (0, false) if none
// found.
func (p *PortPool) allocatePortFromOwners(byPort map[int]string) (int, bool) {
	for port := p.start; port <= p.end; port++ {
		if _, used := byPort[port]; used {
			continue
		}
		if !portFree(port) {
			// OS already bound this port; skip it permanently for this process run.
			// Marking it here prevents repeated probing on every AcquireOrReuse call.
			// The sentinel is intentionally never removed — port availability is
			// determined at startup and does not change mid-run in normal operation.
			byPort[port] = "__os__"
			continue
		}
		return port, true
	}
	return 0, false
}

func normalizeForwardSpecs(desired []ForwardSpec) []ForwardSpec {
	if len(desired) == 0 {
		return DefaultForwardSpecs()
	}
	out := make([]ForwardSpec, len(desired))
	copy(out, desired)
	return out
}

func clonePortOwners(in map[int]string) map[int]string {
	out := make(map[int]string, len(in))
	for port, owner := range in {
		out[port] = owner
	}
	return out
}

// portFree probes whether port is available on 127.0.0.1.
// It opens and immediately closes a TCP listener; returns true when the bind
// succeeds (port is free), false when it fails (port is in use).
func portFree(port int) bool {
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return false
	}
	_ = ln.Close()
	return true
}
