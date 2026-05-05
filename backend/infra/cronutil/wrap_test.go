package cronutil_test

import (
	"sync/atomic"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/websoft9/appos/backend/infra/cronutil"
	_ "github.com/websoft9/appos/backend/infra/migrations"
)

// newApp creates a lightweight PocketBase test app and registers cleanup.
// We rely on tests.NewTestApp because core.App is a large interface and
// creating a hand-rolled stub would require implementing dozens of unrelated
// methods.
func newApp(t *testing.T) core.App {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("tests.NewTestApp: %v", err)
	}
	t.Cleanup(app.Cleanup)
	return app
}

// ─── Wrap ────────────────────────────────────────────────────────────────────

// TestWrap_ExecutesFn verifies that the wrapped function is actually called.
func TestWrap_ExecutesFn(t *testing.T) {
	app := newApp(t)

	var called atomic.Int32
	wrapped := cronutil.Wrap(app, "test_job", func() { called.Add(1) })
	wrapped()

	if called.Load() != 1 {
		t.Errorf("fn called %d time(s), want 1", called.Load())
	}
}

// TestWrap_RepeatableCall confirms the wrapped function can be invoked more
// than once without error.
func TestWrap_RepeatableCall(t *testing.T) {
	app := newApp(t)

	var count atomic.Int32
	wrapped := cronutil.Wrap(app, "repeat_job", func() { count.Add(1) })
	for i := 0; i < 3; i++ {
		wrapped()
	}
	if count.Load() != 3 {
		t.Errorf("fn called %d time(s), want 3", count.Load())
	}
}

// TestWrap_PanicIsReraised checks that a panic inside fn escapes the wrapper
// (so PocketBase's default panic-handling still kicks in).
func TestWrap_PanicIsReraised(t *testing.T) {
	app := newApp(t)

	wrapped := cronutil.Wrap(app, "panic_job", func() { panic("intentional test panic") })

	defer func() {
		r := recover()
		if r == nil {
			t.Error("expected panic to be reraised, but got nil recover")
			return
		}
		s, ok := r.(string)
		if !ok || s != "intentional test panic" {
			t.Errorf("recovered value = %v, want %q", r, "intentional test panic")
		}
	}()

	wrapped()
}

// TestWrap_PanicDoesNotCallFnTwice verifies that fn is invoked exactly once
// even when it panics.
func TestWrap_PanicDoesNotCallFnTwice(t *testing.T) {
	app := newApp(t)

	var calls atomic.Int32
	wrapped := cronutil.Wrap(app, "panic_once_job", func() {
		calls.Add(1)
		panic("boom")
	})

	func() {
		defer func() { recover() }()
		wrapped()
	}()

	if calls.Load() != 1 {
		t.Errorf("fn called %d time(s), want exactly 1", calls.Load())
	}
}
