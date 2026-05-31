package inventory

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	swcatalog "github.com/websoft9/appos/backend/domain/software/catalog"
)

func TestDetectVersionStatic(t *testing.T) {
	var app core.App
	v, err := DetectVersion(app, swcatalog.LocalInventoryProbe{Type: "static", Value: "1.2.3"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v != "1.2.3" {
		t.Fatalf("expected 1.2.3, got %q", v)
	}
}

func TestDetectVersionFile(t *testing.T) {
	var app core.App
	tmp := t.TempDir()
	f := filepath.Join(tmp, "version.txt")
	if err := os.WriteFile(f, []byte("2.0.0\nignored line\n"), 0600); err != nil {
		t.Fatal(err)
	}
	v, err := DetectVersion(app, swcatalog.LocalInventoryProbe{Type: "file", Path: f})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if v != "2.0.0" {
		t.Fatalf("expected 2.0.0, got %q", v)
	}
}

func TestDetectVersionUnknownType(t *testing.T) {
	var app core.App
	if _, err := DetectVersion(app, swcatalog.LocalInventoryProbe{Type: "unknown_probe_type"}); err == nil {
		t.Fatal("expected error for unknown probe type")
	}
}

func TestDetectUpdateTimeFileMtime(t *testing.T) {
	tmp := t.TempDir()
	f := filepath.Join(tmp, "component.bin")
	if err := os.WriteFile(f, []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	updatedAt := DetectUpdateTime(swcatalog.LocalInventoryProbe{Type: "file_mtime", Path: f})
	if updatedAt == "" {
		t.Fatal("expected file_mtime probe to return an update timestamp")
	}
}

func TestCheckAvailabilityStaticTrue(t *testing.T) {
	var app core.App
	ok, err := CheckAvailability(app, swcatalog.LocalInventoryProbe{Type: "static", Success: true})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected true for static probe")
	}
}

func TestCheckAvailabilityFileExists(t *testing.T) {
	var app core.App
	tmp := t.TempDir()
	f := filepath.Join(tmp, "health")
	if err := os.WriteFile(f, []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	ok, err := CheckAvailability(app, swcatalog.LocalInventoryProbe{Type: "file_exists", Path: f})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected true when file exists")
	}
}

func TestCheckAvailabilityHTTPOutput(t *testing.T) {
	var app core.App
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()
	ok, err := CheckAvailability(app, swcatalog.LocalInventoryProbe{Type: "http", URL: srv.URL, ExpectStatus: 200, ExpectOutput: `"status":"ok"`})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected available when body contains expected output")
	}
}

func TestCheckAvailabilityUnknownType(t *testing.T) {
	var app core.App
	if _, err := CheckAvailability(app, swcatalog.LocalInventoryProbe{Type: "unknown_probe_type"}); err == nil {
		t.Fatal("expected error for unknown probe type")
	}
}
