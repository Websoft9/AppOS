package tunnel

import (
	"sync"
	"testing"
	"time"
)

func newTestSession(serverID string) *Session {
	return &Session{
		ServerID:    serverID,
		ConnectedAt: time.Now().UTC(),
	}
}

func TestRegistry_RegisterAndGet(t *testing.T) {
	r := NewRegistry()
	sess := newTestSession("srv1")
	r.Register("srv1", sess)

	got, ok := r.Get("srv1")
	if !ok {
		t.Fatal("Get: expected true, got false")
	}
	if got.ServerID != "srv1" {
		t.Errorf("Get: serverID = %q, want %q", got.ServerID, "srv1")
	}
}

func TestRegistry_GetMissing(t *testing.T) {
	r := NewRegistry()
	_, ok := r.Get("nonexistent")
	if ok {
		t.Error("Get on missing key should return false")
	}
}

func TestRegistry_Unregister(t *testing.T) {
	r := NewRegistry()
	r.Register("srv1", newTestSession("srv1"))
	r.Unregister("srv1")

	_, ok := r.Get("srv1")
	if ok {
		t.Error("Get after Unregister should return false")
	}
}

func TestRegistry_UnregisterNoop(t *testing.T) {
	// Unregister on a non-existent key must not panic.
	r := NewRegistry()
	r.Unregister("ghost")
}

func TestRegistry_All(t *testing.T) {
	r := NewRegistry()
	r.Register("a", newTestSession("a"))
	r.Register("b", newTestSession("b"))

	all := r.All()
	if len(all) != 2 {
		t.Errorf("All() len = %d, want 2", len(all))
	}
}

func TestRegistry_Register_Replaces(t *testing.T) {
	r := NewRegistry()
	sess1 := newTestSession("srv1")
	sess2 := newTestSession("srv1")
	r.Register("srv1", sess1)
	r.Register("srv1", sess2)

	got, _ := r.Get("srv1")
	if got != sess2 {
		t.Error("second Register should replace first entry")
	}
	if len(r.All()) != 1 {
		t.Errorf("All() should have 1 entry after replace, got %d", len(r.All()))
	}
}

func TestRegistry_ConcurrentSafe(t *testing.T) {
	r := NewRegistry()
	const workers = 50
	var wg sync.WaitGroup
	wg.Add(workers * 3)

	// Concurrent registers.
	for i := 0; i < workers; i++ {
		id := string(rune('a' + i%26))
		go func() {
			defer wg.Done()
			r.Register(id, newTestSession(id))
		}()
	}
	// Concurrent gets.
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			r.Get("a")
		}()
	}
	// Concurrent unregisters.
	for i := 0; i < workers; i++ {
		id := string(rune('a' + i%26))
		go func() {
			defer wg.Done()
			r.Unregister(id)
		}()
	}
	wg.Wait()
}
