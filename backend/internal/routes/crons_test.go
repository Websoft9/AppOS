package routes

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"

	_ "github.com/websoft9/appos/backend/internal/migrations"
)

// doCronLogs sends a request to GET /api/crons/{jobId}/logs through the test router.
func (te *testEnv) doCronLogs(t *testing.T, jobID string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	registerCronLogsRoute(&core.ServeEvent{App: te.app, Router: r})

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/crons/"+jobID+"/logs", nil)
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// seedCronLog inserts a structured cron log entry directly into _logs.
func seedCronLog(t *testing.T, te *testEnv, jobID, runID, phase string, durMs *int64) {
	t.Helper()

	data := map[string]any{
		"type":      "cron",
		"component": "system_cron",
		"job_id":    jobID,
		"run_id":    runID,
		"phase":     phase,
		"trigger":   "scheduled",
	}
	if durMs != nil {
		data["duration_ms"] = *durMs
	}

	level := 0 // INFO
	msg := "cron started"
	switch phase {
	case "success":
		msg = "cron finished"
	case "error":
		msg = "cron failed"
		level = 8 // ERROR
		data["error"] = "something went wrong"
	}

	dataJSON, err := json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}

	_, err = te.app.AuxDB().NewQuery(`
		INSERT INTO {{_logs}} ([[id]], [[level]], [[message]], [[data]], [[created]], [[updated]])
		VALUES ({:id}, {:level}, {:msg}, {:data}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`).Bind(map[string]any{
		"id":    runID + "-" + phase,
		"level": level,
		"msg":   msg,
		"data":  string(dataJSON),
	}).Execute()
	if err != nil {
		t.Fatal("seedCronLog:", err)
	}
}

// ─── Tests ─────────────────────────────────────────────────────────────────

func TestCronLogsUnauthorized(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	rec := te.doCronLogs(t, "cleanup_logs", false)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCronLogsSuccess(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	dur := int64(182)
	seedCronLog(t, te, "cleanup_logs", "run-abc", "start", nil)
	seedCronLog(t, te, "cleanup_logs", "run-abc", "success", &dur)

	rec := te.doCronLogs(t, "cleanup_logs", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseBodyCronLogs(t, rec)

	if body["jobId"] != "cleanup_logs" {
		t.Fatalf("jobId mismatch: %v", body["jobId"])
	}
	if body["lastStatus"] != "success" {
		t.Fatalf("lastStatus expected success, got %v", body["lastStatus"])
	}
	if body["lastRun"] == nil {
		t.Fatal("lastRun should not be nil")
	}

	items, ok := body["items"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("items should be non-empty, got %v", body["items"])
	}

	// Verify at least one item has expected fields
	found := false
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["phase"] == "success" {
			found = true
			if item["runId"] != "run-abc" {
				t.Fatalf("runId mismatch: %v", item["runId"])
			}
			if item["trigger"] != "scheduled" {
				t.Fatalf("trigger mismatch: %v", item["trigger"])
			}
		}
	}
	if !found {
		t.Fatal("no success phase item found in response")
	}
}

func TestCronLogsErrorPath(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	dur := int64(50)
	seedCronLog(t, te, "failing_job", "run-xyz", "start", nil)
	seedCronLog(t, te, "failing_job", "run-xyz", "error", &dur)

	rec := te.doCronLogs(t, "failing_job", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseBodyCronLogs(t, rec)
	if body["lastStatus"] != "error" {
		t.Fatalf("lastStatus expected error, got %v", body["lastStatus"])
	}

	items, _ := body["items"].([]any)
	found := false
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		if item["phase"] == "error" {
			found = true
			if item["error"] == nil {
				t.Fatal("error field should not be nil for error phase")
			}
		}
	}
	if !found {
		t.Fatal("no error phase item found in response")
	}
}

func TestCronLogsEmptyForNonInstrumentedJob(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	// No logs seeded for this jobId — should return 200 with empty items list.
	rec := te.doCronLogs(t, "__pb_cleanup__", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseBodyCronLogs(t, rec)
	if body["jobId"] != "__pb_cleanup__" {
		t.Fatalf("jobId mismatch: %v", body["jobId"])
	}
	if body["lastStatus"] != nil {
		t.Fatalf("lastStatus should be nil for empty log, got %v", body["lastStatus"])
	}
	items, _ := body["items"].([]any)
	if len(items) != 0 {
		t.Fatalf("expected empty items, got %d", len(items))
	}
}

func TestCronLogsIsolatedByJobID(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	dur := int64(10)
	seedCronLog(t, te, "job_a", "run-1", "success", &dur)
	seedCronLog(t, te, "job_b", "run-2", "success", &dur)

	rec := te.doCronLogs(t, "job_a", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	body := parseBodyCronLogs(t, rec)
	items, _ := body["items"].([]any)
	for _, raw := range items {
		item, _ := raw.(map[string]any)
		// None of the items should belong to job_b
		if item["runId"] == "run-2" {
			t.Fatal("job_b log leaked into job_a response")
		}
	}
}

// parseBodyCronLogs decodes the response body as map[string]any.
func parseBodyCronLogs(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	bodyBytes, _ := io.ReadAll(strings.NewReader(rec.Body.String()))
	var m map[string]any
	if err := json.Unmarshal(bodyBytes, &m); err != nil {
		t.Fatalf("failed to decode response JSON: %v\nbody: %s", err, rec.Body.String())
	}
	return m
}
