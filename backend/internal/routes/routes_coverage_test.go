package routes

// TestAllExtRoutesCoveredByOpenAPISpec enforces that every /api/ext/* route
// registered in source files has a matching path entry in ext-api.yaml.
//
// Failure means a developer added or renamed a route without updating the spec.
// Fix: add the missing path to backend/docs/openapi/ext-api.yaml.
//
// How it works (static analysis, no runtime router introspection needed):
//  1. Scan every non-test .go file in this package line-by-line.
//  2. Track variable→path assignments from .Group() calls.
//  3. Collect all .GET/.POST/.PUT/.DELETE/.PATCH calls on /api/ext/* prefixes.
//  4. Load ext-api.yaml and extract all documented `paths:` keys.
//  5. Report any code routes absent from the spec.

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"testing"
)

var (
	// Matches: varName := parent.Group("/path")  or  varName = parent.Group("/path")
	reGroupAssign = regexp.MustCompile(`(\w+)\s*:?=\s*(\w+)\.Group\("([^"]*)"\)`)

	// Matches: varName := se.Router.Group("/path")
	reRouterGroupAssign = regexp.MustCompile(`(\w+)\s*:?=\s*(\w+)\.Router\.Group\("([^"]*)"\)`)

	// Matches: varName.METHOD("/path", ...)
	reRouteMethod = regexp.MustCompile(`(\w+)\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("([^"]*)"`)

	// Matches top-level OpenAPI path keys inside the `paths:` block.
	reSpecPathKey = regexp.MustCompile(`^  (/api/ext[^\s:]*):\s*$`)
)

func TestAllExtRoutesCoveredByOpenAPISpec(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	routesDir := filepath.Dir(thisFile)

	// ── Step 1: Extract all /api/ext routes from source files ──────────────
	codeRoutes, err := extractExtRoutes(routesDir)
	if err != nil {
		t.Fatalf("failed to extract routes from source: %v", err)
	}

	// ── Step 2: Load OpenAPI spec ───────────────────────────────────────────
	specPath := filepath.Join(routesDir, "../../docs/openapi/ext-api.yaml")
	specPaths, err := extractSpecPaths(specPath)
	if err != nil {
		// Skip (not fail) if the spec file does not exist yet — allows gradual rollout.
		t.Skipf("OpenAPI spec not found at %s (create it to enable enforcement): %v", specPath, err)
	}

	duplicates, err := extractDuplicateSpecPathKeys(specPath)
	if err != nil {
		t.Fatalf("failed to parse duplicate keys in spec: %v", err)
	}
	if len(duplicates) > 0 {
		sort.Strings(duplicates)
		t.Fatalf(
			"OpenAPI spec has duplicated path key(s), YAML is invalid.\n\n%s",
			strings.Join(duplicates, "\n"),
		)
	}

	// ── Step 3: Report coverage gaps ───────────────────────────────────────
	var missing []string
	for _, cr := range codeRoutes {
		// cr format: "METHOD /api/ext/some/path"
		parts := strings.SplitN(cr, " ", 2)
		if len(parts) != 2 {
			continue
		}
		if _, ok := specPaths[parts[1]]; !ok {
			missing = append(missing, cr)
		}
	}

	t.Logf("Coverage check: %d code routes detected, %d paths in spec", len(codeRoutes), len(specPaths))

	if len(missing) > 0 {
		sort.Strings(missing)
		t.Errorf(
			"%d route(s) registered in code but missing from ext-api.yaml.\n"+
				"Add the following paths to backend/docs/openapi/ext-api.yaml:\n\n%s",
			len(missing), strings.Join(missing, "\n"),
		)
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// extractExtRoutes scans all non-test .go files in dir and returns routes in
// "METHOD /full/path" format for paths that start with /api/ext.
func extractExtRoutes(dir string) ([]string, error) {
	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, err
	}

	var all []string
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		routes, err := extractRoutesFromFile(f)
		if err != nil {
			return nil, fmt.Errorf("parsing %s: %w", filepath.Base(f), err)
		}
		all = append(all, routes...)
	}
	return all, nil
}

// extractRoutesFromFile performs per-file static analysis:
//   - seeds known entry-point variable names with their base paths
//   - tracks Group() chain assignments
//   - collects HTTP method calls on /api/ext prefixes
func extractRoutesFromFile(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	// Seed: variables that arrive as function parameters already pointing at /api/ext.
	// Most registerXxxRoutes(g) receive the /api/ext RouterGroup.
	// Files that use se.Router.Group() directly are handled by the reGroupAssign pass below.
	vars := map[string]string{
		"g":  "/api/ext", // parameter in registerXxxRoutes(g)
		"se": "",         // ServeEvent — Group() calls on se.Router chain below
		"r":  "",         // raw router root
	}

	var routes []string
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()

		// Track Group assignments so nested groups resolve correctly.
		// Example: compose := d.Group("/compose") → compose = /api/ext/docker/compose
		if m := reGroupAssign.FindStringSubmatch(line); m != nil {
			newVar, parent, suffix := m[1], m[2], m[3]
			if base, ok := vars[parent]; ok {
				vars[newVar] = base + suffix
			}
		}

		if m := reRouterGroupAssign.FindStringSubmatch(line); m != nil {
			newVar, parent, suffix := m[1], m[2], m[3]
			if base, ok := vars[parent]; ok {
				vars[newVar] = base + suffix
			}
		}

		// Collect route registrations on any variable whose resolved path is under /api/ext.
		// Example: compose.POST("/up", ...) → POST /api/ext/docker/compose/up
		if m := reRouteMethod.FindStringSubmatch(line); m != nil {
			varName, method, suffix := m[1], m[2], m[3]
			if base, ok := vars[varName]; ok && strings.HasPrefix(base, "/api/ext") {
				routes = append(routes, method+" "+base+suffix)
			}
		}
	}
	return routes, scanner.Err()
}

// extractSpecPaths reads an OpenAPI YAML file and returns all path keys that
// start with /api/ext. Parsing is intentionally line-based to avoid introducing
// a yaml dependency — the format is stable for top-level path keys.
func extractSpecPaths(specPath string) (map[string]struct{}, error) {
	f, err := os.Open(specPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	paths := map[string]struct{}{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if m := reSpecPathKey.FindStringSubmatch(scanner.Text()); m != nil {
			paths[strings.TrimSpace(m[1])] = struct{}{}
		}
	}
	return paths, scanner.Err()
}

// extractDuplicateSpecPathKeys returns any repeated top-level /api/ext path
// keys in the OpenAPI YAML file.
func extractDuplicateSpecPathKeys(specPath string) ([]string, error) {
	f, err := os.Open(specPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	count := map[string]int{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if m := reSpecPathKey.FindStringSubmatch(scanner.Text()); m != nil {
			key := strings.TrimSpace(m[1])
			count[key]++
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	var duplicates []string
	for key, n := range count {
		if n > 1 {
			duplicates = append(duplicates, fmt.Sprintf("%s (%dx)", key, n))
		}
	}
	return duplicates, nil
}
