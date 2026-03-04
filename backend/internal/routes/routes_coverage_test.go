package routes

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
	reGroupAssign       = regexp.MustCompile(`(\w+)\s*:?=\s*(\w+)\.Group\("([^"]*)"\)`)
	reRouterGroupAssign = regexp.MustCompile(`(\w+)\s*:?=\s*(\w+)\.Router\.Group\("([^"]*)"\)`)
	reRouteMethod       = regexp.MustCompile(`(\w+)\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("([^"]*)"`)
	reSpecPathKey       = regexp.MustCompile(`^  (/(?:api/ext|api/servers)[^\s:]*):\s*$`)
)

func TestAllExtRoutesCoveredByOpenAPISpec(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	routesDir := filepath.Dir(thisFile)

	codeRoutes, err := extractCustomRoutes(routesDir)
	if err != nil {
		t.Fatalf("failed to extract routes from source: %v", err)
	}

	specPath := filepath.Join(routesDir, "../../docs/openapi/ext-api.yaml")
	specPaths, err := extractSpecPaths(specPath)
	if err != nil {
		t.Skipf("OpenAPI spec not found at %s (create it to enable enforcement): %v", specPath, err)
	}

	duplicates, err := extractDuplicateSpecPathKeys(specPath)
	if err != nil {
		t.Fatalf("failed to parse duplicate keys in spec: %v", err)
	}
	if len(duplicates) > 0 {
		sort.Strings(duplicates)
		t.Fatalf("OpenAPI spec has duplicated path key(s), YAML is invalid.\n\n%s", strings.Join(duplicates, "\n"))
	}

	var missing []string
	for _, cr := range codeRoutes {
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
		t.Errorf("%d route(s) registered in code but missing from ext-api.yaml.\nAdd the following paths to backend/docs/openapi/ext-api.yaml:\n\n%s", len(missing), strings.Join(missing, "\n"))
	}
}

func extractCustomRoutes(dir string) ([]string, error) {
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

func extractRoutesFromFile(path string) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	defaultG := "/api/ext"
	if strings.HasPrefix(filepath.Base(path), "server") {
		defaultG = "/api/servers"
	}

	vars := map[string]string{
		"g":  defaultG,
		"se": "",
		"r":  "",
	}

	var routes []string
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()

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

		if m := reRouteMethod.FindStringSubmatch(line); m != nil {
			varName, method, suffix := m[1], m[2], m[3]
			if base, ok := vars[varName]; ok && (strings.HasPrefix(base, "/api/ext") || strings.HasPrefix(base, "/api/servers")) {
				routes = append(routes, method+" "+base+suffix)
			}
		}
	}

	return routes, scanner.Err()
}

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
