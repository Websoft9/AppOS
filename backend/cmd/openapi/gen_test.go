package main

import (
	"path/filepath"
	"runtime"
	"testing"
)

func fixtureRoutesDir(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current file")
	}
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "domain", "routes")
}

func TestLoadRouteFunctionSeeds(t *testing.T) {
	routesDir := fixtureRoutesDir(t)

	seeds, err := loadRouteFunctionSeeds(routesDir)
	if err != nil {
		t.Fatalf("load route function seeds: %v", err)
	}

	tests := []struct {
		name     string
		funcName string
		basePath string
		auth     string
	}{
		{name: "server software helper", funcName: "registerSoftwareRoutes", basePath: "/api/servers", auth: "auth"},
		{name: "local software helper", funcName: "registerLocalSoftwareRoutes", basePath: "/api/software", auth: "auth"},
		{name: "terminal helper", funcName: "registerTerminalRoutes", basePath: "/api/terminal", auth: "superuser"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			seed, ok := seeds[tc.funcName]
			if !ok {
				t.Fatalf("missing seed for %s", tc.funcName)
			}
			if seed.basePath != tc.basePath {
				t.Fatalf("seed basePath = %q, want %q", seed.basePath, tc.basePath)
			}
			if seed.auth != tc.auth {
				t.Fatalf("seed auth = %q, want %q", seed.auth, tc.auth)
			}
		})
	}
}

func TestScanFile_WithHelperSeedsDiscoversSoftwareRoutes(t *testing.T) {
	routesDir := fixtureRoutesDir(t)

	seeds, err := loadRouteFunctionSeeds(routesDir)
	if err != nil {
		t.Fatalf("load route function seeds: %v", err)
	}

	routes, _ := scanFile(filepath.Join(routesDir, "software.go"), seeds, handlerMetadata{})
	if len(routes) == 0 {
		t.Fatal("expected software routes to be discovered")
	}

	want := map[string]string{
		"GET /api/servers/{serverId}/software":                          "auth",
		"GET /api/servers/{serverId}/software/{componentKey}":           "auth",
		"POST /api/servers/{serverId}/software/{componentKey}/{action}": "auth",
		"GET /api/servers/{serverId}/software/capabilities":             "auth",
		"GET /api/servers/{serverId}/software/operations":               "auth",
		"GET /api/servers/{serverId}/software/operations/{operationId}": "auth",
		"DELETE /api/servers/{serverId}/software/operations/{operationId}": "auth",
		"GET /api/software/local":                                       "auth",
		"GET /api/software/local/{componentKey}":                        "auth",
		"GET /api/software/server-catalog":                              "auth",
		"GET /api/software/server-catalog/{componentKey}":               "auth",
	}

	got := map[string]string{}
	for _, route := range routes {
		got[route.method+" "+route.path] = route.detectedAuth
	}

	for key, auth := range want {
		gotAuth, ok := got[key]
		if !ok {
			t.Fatalf("missing discovered route %s", key)
		}
		if gotAuth != auth {
			t.Fatalf("route %s auth = %q, want %q", key, gotAuth, auth)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("discovered %d routes, want %d", len(got), len(want))
	}
}

func TestScanFile_WithInlineGroupHelperDiscoversSecretsRoutes(t *testing.T) {
	routesDir := fixtureRoutesDir(t)

	seeds, err := loadRouteFunctionSeeds(routesDir)
	if err != nil {
		t.Fatalf("load route function seeds: %v", err)
	}

	routes, _ := scanFile(filepath.Join(routesDir, "secrets.go"), seeds, handlerMetadata{})
	if len(routes) == 0 {
		t.Fatal("expected secrets routes to be discovered")
	}

	want := map[string]bool{
		"GET /api/secrets/templates":    true,
		"PUT /api/secrets/{id}/payload": true,
		"POST /api/secrets/resolve":     true,
		"GET /api/secrets/{id}/reveal":  true,
	}

	got := map[string]bool{}
	for _, route := range routes {
		got[route.method+" "+route.path] = true
	}

	for key := range want {
		if !got[key] {
			t.Fatalf("missing discovered route %s", key)
		}
	}
	if len(got) != len(want) {
		t.Fatalf("discovered %d routes, want %d", len(got), len(want))
	}
}
