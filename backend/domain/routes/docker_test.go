package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	servers "github.com/websoft9/appos/backend/domain/resource/servers"
)

func TestTunnelSSHPortFromServices(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    int
		wantErr bool
	}{
		{
			name:    "valid ssh service",
			raw:     `[{"service_name":"ssh","tunnel_port":42001},{"service_name":"http","tunnel_port":42002}]`,
			want:    42001,
			wantErr: false,
		},
		{
			name:    "missing ssh service",
			raw:     `[{"service_name":"http","tunnel_port":42002}]`,
			want:    0,
			wantErr: true,
		},
		{
			name:    "empty services",
			raw:     ``,
			want:    0,
			wantErr: true,
		},
		{
			name:    "invalid json",
			raw:     `{bad json}`,
			want:    0,
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := servers.TunnelSSHPortFromServices(tt.raw)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}

func doDocker(t *testing.T, te *testEnv, method, url, body, token string) *httptest.ResponseRecorder {
	t.Helper()

	r, err := apis.NewRouter(te.app)
	if err != nil {
		t.Fatal(err)
	}

	g := r.Group("/api/servers")
	g.Bind(apis.RequireAuth())
	registerDockerRoutes(g)

	mux, err := r.BuildMux()
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(method, url, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", token)
	}

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func createRegularUserToken(t *testing.T, te *testEnv) string {
	t.Helper()

	usersCol, err := te.app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(usersCol)
	user.Set("email", "user@test.com")
	user.SetPassword("1234567890")
	if err := te.app.Save(user); err != nil {
		t.Fatal(err)
	}

	token, err := user.NewStaticAuthToken(0)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestDockerRoutesRequireSuperuser(t *testing.T) {
	te := newTestEnv(t)
	defer te.cleanup()

	userToken := createRegularUserToken(t, te)

	rec := doDocker(t, te, http.MethodGet, "/api/servers/docker-targets", "", userToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for non-superuser, got %d: %s", rec.Code, rec.Body.String())
	}

	rec = doDocker(t, te, http.MethodGet, "/api/servers/docker-targets", "", te.token)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for superuser, got %d: %s", rec.Code, rec.Body.String())
	}
}
