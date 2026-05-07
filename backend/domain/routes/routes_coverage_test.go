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
	reInlineGroupCall   = regexp.MustCompile(`\b(register[A-Za-z_][A-Za-z0-9_]*)\((\w+)(\.Router)?\.Group\("([^"]*)"\)\)`)
	reFuncSignature     = regexp.MustCompile(`^func\s*(\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)`)
	reRegisterCall      = regexp.MustCompile(`\b(register[A-Za-z_][A-Za-z0-9_]*)\((\w+)\)`)
	reRouteMethod       = regexp.MustCompile(`(\w+)\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("([^"]*)"`)
	reRootRouterMethod  = regexp.MustCompile(`(\w+)\.Router\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("([^"]*)"`)
	reSpecPathKey       = regexp.MustCompile(`^  (/(?:api|tunnel/setup)[^\s:]*):\s*$`)
	reSpecMethodKey     = regexp.MustCompile(`^    (get|post|put|delete|patch|head):\s*$`)
)

type matrixGroup struct {
	name       string
	apiType    string
	extSurface []string
}

type functionSeed struct {
	basePath string
}

func TestAllCustomRoutesCoveredByOpenAPISpec(t *testing.T) {
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
		t.Errorf("%d custom route(s) registered in code but missing from the generated custom-route spec.\nAdd the following paths to backend/docs/openapi/ext-api.yaml:\n\n%s", len(missing), strings.Join(missing, "\n"))
	}
}

func TestAllMatrixExtSurfacesHaveGeneratedSpecAnchors(t *testing.T) {
	_, thisFile, _, _ := runtime.Caller(0)
	routesDir := filepath.Dir(thisFile)

	specPath := filepath.Join(routesDir, "../../docs/openapi/ext-api.yaml")
	specOps, err := extractSpecOperations(specPath)
	if err != nil {
		t.Skipf("OpenAPI spec not found at %s (create it to enable enforcement): %v", specPath, err)
	}

	matrixPath := filepath.Join(routesDir, "../../docs/openapi/group-matrix.yaml")
	groups, err := extractMatrixGroups(matrixPath)
	if err != nil {
		t.Fatalf("failed to parse group matrix: %v", err)
	}

	var missing []string
	for _, group := range groups {
		apiType := strings.ToLower(strings.TrimSpace(group.apiType))
		if apiType != "ext" && apiType != "mixed" {
			continue
		}
		for _, surface := range group.extSurface {
			matched := false
			for _, op := range specOps {
				if matrixSurfaceMatchesRoute(surface, op) {
					matched = true
					break
				}
			}
			if !matched {
				missing = append(missing, fmt.Sprintf("[%s] %s", group.name, strings.TrimSpace(surface)))
			}
		}
	}

	if len(missing) > 0 {
		sort.Strings(missing)
		t.Fatalf("%d group-matrix extSurface pattern(s) have no matching generated path in backend/docs/openapi/ext-api.yaml. make openapi-gen is not producing these entries.\n\n%s", len(missing), strings.Join(missing, "\n"))
	}
}

func extractCustomRoutes(dir string) ([]string, error) {
	seeds, err := loadRouteFunctionSeeds(dir)
	if err != nil {
		return nil, err
	}

	files, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		return nil, err
	}

	var all []string
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		routes, err := extractRoutesFromFile(f, seeds)
		if err != nil {
			return nil, fmt.Errorf("parsing %s: %w", filepath.Base(f), err)
		}
		all = append(all, routes...)
	}
	return all, nil
}

func extractRoutesFromFile(path string, seeds map[string]functionSeed) ([]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	defaultG := "/api/ext"
	if strings.HasPrefix(filepath.Base(path), "server") {
		defaultG = "/api/servers"
	}
	if strings.HasPrefix(filepath.Base(path), "terminal") {
		defaultG = "/api/terminal"
	}
	if filepath.Base(path) == "components.go" {
		defaultG = "/api/components"
	}
	if filepath.Base(path) == "deploy.go" || filepath.Base(path) == "apps.go" || filepath.Base(path) == "lifecycle_resources.go" || filepath.Base(path) == "catalog.go" {
		defaultG = "/api"
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
		trim := strings.TrimSpace(line)

		if m := reInlineGroupCall.FindStringSubmatch(line); m != nil {
			funcName, parent, routerSelector, suffix := m[1], m[2], m[3], m[4]
			basePath := ""
			if base, ok := vars[parent]; ok && base != "" {
				basePath = base + suffix
			} else if routerSelector != "" {
				basePath = suffix
			}
			if basePath != "" {
				seeds[funcName] = functionSeed{basePath: basePath}
			}
		}

		if m := reFuncSignature.FindStringSubmatch(trim); m != nil {
			if seed, ok := seeds[m[2]]; ok {
				paramName := firstParamName(m[3])
				if paramName != "" {
					vars[paramName] = seed.basePath
				}
			}
		}

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

		if m := reRegisterCall.FindStringSubmatch(line); m != nil {
			funcName, argName := m[1], m[2]
			if basePath, ok := vars[argName]; ok && basePath != "" {
				seeds[funcName] = functionSeed{basePath: basePath}
			}
		}

		if m := reRouteMethod.FindStringSubmatch(line); m != nil {
			varName, method, suffix := m[1], m[2], m[3]
			if base, ok := vars[varName]; ok && (strings.HasPrefix(base, "/api/") || strings.HasPrefix(base, "/tunnel/setup")) {
				routes = append(routes, method+" "+base+suffix)
			}
		}

		if m := reRootRouterMethod.FindStringSubmatch(line); m != nil {
			varName, method, suffix := m[1], m[2], m[3]
			if base, ok := vars[varName]; ok {
				fullPath := base + suffix
				if strings.HasPrefix(fullPath, "/api/") || strings.HasPrefix(fullPath, "/tunnel/setup") {
					routes = append(routes, method+" "+fullPath)
				}
			}
		}
	}

	return routes, scanner.Err()
}

func loadRouteFunctionSeeds(routesDir string) (map[string]functionSeed, error) {
	path := filepath.Join(routesDir, "routes.go")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	vars := map[string]string{"se": ""}
	seeds := map[string]functionSeed{}

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

		if m := reRegisterCall.FindStringSubmatch(line); m != nil {
			funcName, argName := m[1], m[2]
			if basePath, ok := vars[argName]; ok {
				seeds[funcName] = functionSeed{basePath: basePath}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return seeds, nil
}

func firstParamName(params string) string {
	trimmed := strings.TrimSpace(params)
	if trimmed == "" {
		return ""
	}
	first := strings.Split(trimmed, ",")[0]
	fields := strings.Fields(strings.TrimSpace(first))
	if len(fields) == 0 {
		return ""
	}
	return strings.TrimSpace(fields[0])
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

func extractSpecOperations(specPath string) ([]string, error) {
	f, err := os.Open(specPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var ops []string
	currentPath := ""
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if m := reSpecPathKey.FindStringSubmatch(line); m != nil {
			currentPath = strings.TrimSpace(m[1])
			continue
		}
		if m := reSpecMethodKey.FindStringSubmatch(line); m != nil && currentPath != "" {
			ops = append(ops, strings.ToUpper(strings.TrimSpace(m[1]))+" "+currentPath)
		}
	}
	return ops, scanner.Err()
}

func extractMatrixGroups(matrixPath string) ([]matrixGroup, error) {
	f, err := os.Open(matrixPath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var groups []matrixGroup
	var current *matrixGroup
	inExtSurface := false

	flush := func() {
		if current == nil {
			return
		}
		groups = append(groups, *current)
		current = nil
		inExtSurface = false
	}

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()

		if strings.HasPrefix(line, "  - group:") {
			flush()
			current = &matrixGroup{name: strings.TrimSpace(strings.TrimPrefix(line, "  - group:"))}
			continue
		}
		if current == nil {
			continue
		}

		if strings.HasPrefix(line, "    apiType:") {
			current.apiType = strings.TrimSpace(strings.TrimPrefix(line, "    apiType:"))
			inExtSurface = false
			continue
		}
		if strings.HasPrefix(line, "    extSurface:") {
			inExtSurface = true
			continue
		}
		if inExtSurface && strings.HasPrefix(line, "      - ") {
			current.extSurface = append(current.extSurface, strings.TrimSpace(strings.TrimPrefix(line, "      - ")))
			continue
		}
		if inExtSurface && strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "      ") {
			inExtSurface = false
		}
	}
	flush()

	return groups, scanner.Err()
}

func matrixSurfaceMatchesRoute(surface string, route string) bool {
	method, path, hasMethod := parseSurfacePattern(surface)
	routeMethod, routePath, ok := parseRouteEntry(route)
	if !ok {
		return false
	}
	if hasMethod && method != routeMethod {
		return false
	}
	if strings.HasSuffix(path, "*") {
		prefix := strings.TrimSuffix(path, "*")
		base := strings.TrimSuffix(prefix, "/")
		return routePath == base || strings.HasPrefix(routePath, prefix)
	}
	return routePath == path
}

func parseSurfacePattern(surface string) (method string, path string, hasMethod bool) {
	parts := strings.Fields(strings.TrimSpace(surface))
	if len(parts) >= 2 {
		candidate := strings.ToUpper(strings.TrimSpace(parts[0]))
		switch candidate {
		case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD":
			return candidate, strings.TrimSpace(parts[1]), true
		}
	}
	return "", strings.TrimSpace(surface), false
}

func parseRouteEntry(route string) (method string, path string, ok bool) {
	parts := strings.Fields(strings.TrimSpace(route))
	if len(parts) != 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}
