package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
)

func (te *testEnv) doLifecycleResources(t *testing.T, method, url, body string, authenticated bool) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api")
	g.Bind(apis.RequireAuth())
	registerAppsRoutes(g)
	registerReleaseRoutes(g)
	registerExposureRoutes(g)

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.Header.Set("Authorization", te.token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func seedReleaseAndExposure(t *testing.T, te *testEnv, appRecord *core.Record) (*core.Record, *core.Record) {
	t.Helper()

	operation := seedAppOperation(t, te, appRecord)

	releasesCol, err := te.app.FindCollectionByNameOrId("app_releases")
	if err != nil {
		t.Fatal(err)
	}
	release := core.NewRecord(releasesCol)
	release.Set("app", appRecord.Id)
	release.Set("created_by_operation", operation.Id)
	release.Set("release_role", "active")
	release.Set("version_label", "v1.0.0")
	release.Set("source_type", "manual")
	release.Set("source_ref", "seed://manual")
	release.Set("rendered_compose", operation.GetString("rendered_compose"))
	release.Set("is_active", true)
	release.Set("is_last_known_good", true)
	release.Set("activated_at", time.Now())
	if err := te.app.Save(release); err != nil {
		t.Fatal(err)
	}

	exposuresCol, err := te.app.FindCollectionByNameOrId("app_exposures")
	if err != nil {
		t.Fatal(err)
	}
	exposure := core.NewRecord(exposuresCol)
	exposure.Set("app", appRecord.Id)
	exposure.Set("release", release.Id)
	exposure.Set("exposure_type", "domain")
	exposure.Set("is_primary", true)
	exposure.Set("domain", "demo.local")
	exposure.Set("path", "/")
	exposure.Set("target_port", 8080)
	exposure.Set("publication_state", "published")
	exposure.Set("health_state", "healthy")
	exposure.Set("last_verified_at", time.Now())
	if err := te.app.Save(exposure); err != nil {
		t.Fatal(err)
	}

	appRecord.Set("current_release", release.Id)
	appRecord.Set("primary_exposure", exposure.Id)
	if err := te.app.Save(appRecord); err != nil {
		t.Fatal(err)
	}

	return release, exposure
}

func TestReleaseAndExposureRoutes(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	appRecord := seedAppInstance(t, te, "demo-app")
	release, exposure := seedReleaseAndExposure(t, te, appRecord)

	rec := te.doLifecycleResources(t, http.MethodGet, "/api/releases", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("releases list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	releases := parseJSONArray(t, rec)
	if len(releases) != 1 || releases[0]["id"] != release.Id {
		t.Fatalf("unexpected releases payload: %v", releases)
	}

	rec = te.doLifecycleResources(t, http.MethodGet, "/api/releases/"+release.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("release detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	releaseDetail := parseJSON(t, rec)
	if releaseDetail["release_role"] != "active" {
		t.Fatalf("expected active release role, got %v", releaseDetail["release_role"])
	}

	rec = te.doLifecycleResources(t, http.MethodGet, "/api/apps/"+appRecord.Id+"/releases", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("app releases: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	appReleases := parseJSONArray(t, rec)
	if len(appReleases) != 1 || appReleases[0]["id"] != release.Id {
		t.Fatalf("unexpected app releases payload: %v", appReleases)
	}

	rec = te.doLifecycleResources(t, http.MethodGet, "/api/apps/"+appRecord.Id+"/releases/current", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("current release: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if parseJSON(t, rec)["id"] != release.Id {
		t.Fatalf("expected current release id %s", release.Id)
	}

	rec = te.doLifecycleResources(t, http.MethodGet, "/api/exposures", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("exposures list: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	exposures := parseJSONArray(t, rec)
	if len(exposures) != 1 || exposures[0]["id"] != exposure.Id {
		t.Fatalf("unexpected exposures payload: %v", exposures)
	}

	rec = te.doLifecycleResources(t, http.MethodGet, "/api/exposures/"+exposure.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("exposure detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	exposureDetail := parseJSON(t, rec)
	if exposureDetail["domain"] != "demo.local" {
		t.Fatalf("expected demo.local domain, got %v", exposureDetail["domain"])
	}

	rec = te.doLifecycleResources(t, http.MethodGet, "/api/apps/"+appRecord.Id+"/exposures", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("app exposures: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	appExposures := parseJSONArray(t, rec)
	if len(appExposures) != 1 || appExposures[0]["id"] != exposure.Id {
		t.Fatalf("unexpected app exposures payload: %v", appExposures)
	}

	rec = te.doLifecycleResources(t, http.MethodGet, "/api/apps/"+appRecord.Id+"/exposures/"+exposure.Id, "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("app exposure detail: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if parseJSON(t, rec)["id"] != exposure.Id {
		t.Fatalf("expected app exposure id %s", exposure.Id)
	}
}

func TestReleaseRoutesExposeSourceBuildCandidateAndPromotedArtifactInfo(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	appRecord := seedAppInstance(t, te, "source-build-demo")
	operation := seedAppOperation(t, te, appRecord)

	releasesCol, err := te.app.FindCollectionByNameOrId("app_releases")
	if err != nil {
		t.Fatal(err)
	}

	candidateRelease := core.NewRecord(releasesCol)
	candidateRelease.Set("app", appRecord.Id)
	candidateRelease.Set("created_by_operation", operation.Id)
	candidateRelease.Set("release_role", "candidate")
	candidateRelease.Set("version_label", "source-build-demo-20260401-candidate")
	candidateRelease.Set("source_type", "file")
	candidateRelease.Set("source_ref", "apps/source-build-demo/src")
	candidateRelease.Set("rendered_compose", operation.GetString("rendered_compose"))
	candidateRelease.Set("artifact_digest", "apps/source-build-demo:candidate")
	candidateRelease.Set("is_active", false)
	candidateRelease.Set("is_last_known_good", false)
	candidateRelease.Set("notes", "uploaded source package | Source build candidate | target=registry://default/apps/source-build-demo")
	if err := te.app.Save(candidateRelease); err != nil {
		t.Fatal(err)
	}

	activeRelease := core.NewRecord(releasesCol)
	activeRelease.Set("app", appRecord.Id)
	activeRelease.Set("created_by_operation", operation.Id)
	activeRelease.Set("release_role", "active")
	activeRelease.Set("version_label", "source-build-demo-20260401")
	activeRelease.Set("source_type", "file")
	activeRelease.Set("source_ref", "apps/source-build-demo/src")
	activeRelease.Set("rendered_compose", operation.GetString("rendered_compose"))
	activeRelease.Set("artifact_digest", "apps/source-build-demo@sha256:abc123")
	activeRelease.Set("is_active", true)
	activeRelease.Set("is_last_known_good", true)
	activeRelease.Set("activated_at", time.Now())
	activeRelease.Set("notes", "uploaded source package | Source build promoted | target=registry://default/apps/source-build-demo")
	if err := te.app.Save(activeRelease); err != nil {
		t.Fatal(err)
	}

	appRecord.Set("current_release", activeRelease.Id)
	if err := te.app.Save(appRecord); err != nil {
		t.Fatal(err)
	}

	rec := te.doLifecycleResources(t, http.MethodGet, "/api/apps/"+appRecord.Id+"/releases", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("app releases: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	releases := parseJSONArray(t, rec)
	if len(releases) != 2 {
		t.Fatalf("expected 2 releases, got %v", releases)
	}

	seenCandidate := false
	seenActive := false
	for _, release := range releases {
		switch release["id"] {
		case candidateRelease.Id:
			seenCandidate = true
			if release["release_role"] != "candidate" {
				t.Fatalf("expected candidate release_role, got %v", release["release_role"])
			}
			if release["artifact_digest"] != "apps/source-build-demo:candidate" {
				t.Fatalf("unexpected candidate artifact_digest: %v", release["artifact_digest"])
			}
			if release["source_ref"] != "apps/source-build-demo/src" {
				t.Fatalf("unexpected candidate source_ref: %v", release["source_ref"])
			}
			if !strings.Contains(release["notes"].(string), "Source build candidate") {
				t.Fatalf("expected candidate notes to mention source build candidate, got %v", release["notes"])
			}
		case activeRelease.Id:
			seenActive = true
			if release["release_role"] != "active" {
				t.Fatalf("expected active release_role, got %v", release["release_role"])
			}
			if release["artifact_digest"] != "apps/source-build-demo@sha256:abc123" {
				t.Fatalf("unexpected active artifact_digest: %v", release["artifact_digest"])
			}
			if release["source_ref"] != "apps/source-build-demo/src" {
				t.Fatalf("unexpected active source_ref: %v", release["source_ref"])
			}
			if release["version_label"] != "source-build-demo-20260401" {
				t.Fatalf("unexpected active version_label: %v", release["version_label"])
			}
		}
	}
	if !seenCandidate || !seenActive {
		t.Fatalf("expected both candidate and active releases in payload, got %v", releases)
	}

	rec = te.doLifecycleResources(t, http.MethodGet, "/api/apps/"+appRecord.Id+"/releases/current", "", true)
	if rec.Code != http.StatusOK {
		t.Fatalf("current release: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	current := parseJSON(t, rec)
	if current["id"] != activeRelease.Id {
		t.Fatalf("expected current release id %s, got %v", activeRelease.Id, current["id"])
	}
	if current["artifact_digest"] != "apps/source-build-demo@sha256:abc123" {
		t.Fatalf("unexpected current release artifact_digest: %v", current["artifact_digest"])
	}
	if current["source_ref"] != "apps/source-build-demo/src" {
		t.Fatalf("unexpected current release source_ref: %v", current["source_ref"])
	}
}
