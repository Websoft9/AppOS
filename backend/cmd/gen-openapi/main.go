//go:build ignore

// gen-openapi scans all /api/ext/* routes from the routes package source files
// and generates (or updates) backend/docs/openapi/ext-api.yaml.
//
// Usage:
//
//	go run backend/cmd/gen-openapi/main.go
//
// Behaviour:
//   - Infers auth type (public / auth / superuser) from .Bind() calls in source
//   - Infers business-domain tag from path prefix
//   - Generates a YAML skeleton for every route not yet in the spec
//   - Preserves existing manually-written path entries (merge-safe)
//
// Run via Makefile:
//
//	make openapi-gen

package main

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
)

// ── regex patterns ────────────────────────────────────────────────────────────

var (
	reGroupAssign  = regexp.MustCompile(`(\w+)\s*:?=\s*(\w+)\.Group\("([^"]*)"\)`)
	reRouterGroupAssign = regexp.MustCompile(`(\w+)\s*:?=\s*(\w+)\.Router\.Group\("([^"]*)"\)`)
	reRouteMethod  = regexp.MustCompile(`(\w+)\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("([^"]*)"`)
	reRouteMethodHandler = regexp.MustCompile(`(\w+)\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("([^"]*)"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)`)
	reSuperuserBind = regexp.MustCompile(`(\w+)\.Bind\(apis\.RequireSuperuserAuth\(\)\)`)
	rePathParam    = regexp.MustCompile(`\{([^}]+)\}`)
	reFuncStart    = regexp.MustCompile(`^func\s*(\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(`)
	reQueryGet     = regexp.MustCompile(`Query\(\)\.Get\("([^"]+)"\)`)
)

// publicPrefixes: routes whose full path starts with these are unauthenticated.
var publicPrefixes = []string{
	"/api/ext/setup",
	"/api/ext/auth",
	"/api/ext/space/preview",
	"/api/ext/space/share",
	"/tunnel/setup",
	"/openapi",
}

// tagFromPath maps an /api/ext/* path to a business-domain OpenAPI tag.
func tagFromPath(path string) string {
	switch {
	case strings.Contains(path, "/logs"):
		return "Logs"
	case strings.HasPrefix(path, "/api/ext/setup"), strings.HasPrefix(path, "/api/ext/auth"):
		return "Platform Bootstrap"
	case strings.HasPrefix(path, "/api/ext/docker"),
		strings.HasPrefix(path, "/api/ext/services"),
		strings.HasPrefix(path, "/api/ext/proxy"),
		strings.HasPrefix(path, "/api/ext/system"),
		strings.HasPrefix(path, "/api/ext/backup"):
		return "Runtime Operations"
	case strings.HasPrefix(path, "/api/ext/resources"):
		return "Resource"
	case strings.HasPrefix(path, "/api/ext/settings"):
		return "Settings"
	case strings.HasPrefix(path, "/api/ext/users"):
		return "Users"
	case strings.HasPrefix(path, "/api/ext/space"):
		return "Space"
	case strings.HasPrefix(path, "/api/ext/iac"):
		return "IaC"
	case strings.HasPrefix(path, "/api/ext/terminal"):
		return "Servers Operate"
	case strings.HasPrefix(path, "/api/ext/tunnel"):
		return "Tunnel"
	case strings.HasPrefix(path, "/api/ext/audit"):
		return "Audit"
	default:
		return "Other"
	}
}

// authForPath derives public / auth / superuser from the resolved variable auth map.
func authForPath(path string, superuserVarPaths map[string]bool) string {
	for _, pub := range publicPrefixes {
		if strings.HasPrefix(path, pub) {
			return "public"
		}
	}
	for varPath := range superuserVarPaths {
		if strings.HasPrefix(path, varPath) {
			return "superuser"
		}
	}
	return "auth"
}

// route is a single discovered route entry.
type route struct {
	method string
	path   string
	handler string
	queryParams []string
}

// ── per-file scanner ──────────────────────────────────────────────────────────

func scanFile(filePath string) ([]route, map[string]bool) {
	data, _ := os.ReadFile(filePath)
	handlerQueries := extractHandlerQueryParams(string(data))

	vars := map[string]string{
		"g":  "/api/ext",
		"se": "",
		"r":  "",
	}
	superuserVarPaths := map[string]bool{} // resolved base path → is superuser

	var routes []route
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()

		// Track Group assignments
		if m := reGroupAssign.FindStringSubmatch(line); m != nil {
			newVar, parent, suffix := m[1], m[2], m[3]
			if base, ok := vars[parent]; ok {
				vars[newVar] = base + suffix
			}
		}

		// Track ServeEvent router group assignments, e.g.:
		//   setup := se.Router.Group("/api/ext/setup")
		if m := reRouterGroupAssign.FindStringSubmatch(line); m != nil {
			newVar, parent, suffix := m[1], m[2], m[3]
			if base, ok := vars[parent]; ok {
				vars[newVar] = base + suffix
			}
		}

		// Track superuser bindings
		if m := reSuperuserBind.FindStringSubmatch(line); m != nil {
			varName := m[1]
			if base, ok := vars[varName]; ok && base != "" {
				superuserVarPaths[base] = true
			}
		}

		// Collect route registrations
		if m := reRouteMethod.FindStringSubmatch(line); m != nil {
			varName, method, suffix := m[1], m[2], m[3]
			if base, ok := vars[varName]; ok && strings.HasPrefix(base, "/api/ext") {
				r := route{method: method, path: base + suffix}
				if hm := reRouteMethodHandler.FindStringSubmatch(line); hm != nil {
					h := hm[4]
					r.handler = h
					r.queryParams = handlerQueries[h]
				}
				routes = append(routes, r)
			}
		}
	}
	return routes, superuserVarPaths
}

func extractHandlerQueryParams(src string) map[string][]string {
	out := map[string][]string{}
	scanner := bufio.NewScanner(strings.NewReader(src))

	currentFunc := ""
	braceDepth := 0
	started := false
	seen := map[string]map[string]struct{}{}

	for scanner.Scan() {
		line := scanner.Text()
		trim := strings.TrimSpace(line)

		if currentFunc == "" {
			if m := reFuncStart.FindStringSubmatch(trim); m != nil {
				currentFunc = m[2]
				braceDepth = strings.Count(line, "{") - strings.Count(line, "}")
				started = strings.Contains(line, "{")
				if _, ok := seen[currentFunc]; !ok {
					seen[currentFunc] = map[string]struct{}{}
				}
			}
			continue
		}

		for _, m := range reQueryGet.FindAllStringSubmatch(line, -1) {
			if len(m) >= 2 {
				seen[currentFunc][m[1]] = struct{}{}
			}
		}

		braceDepth += strings.Count(line, "{")
		braceDepth -= strings.Count(line, "}")
		if strings.Contains(line, "{") {
			started = true
		}

		if started && braceDepth <= 0 {
			currentFunc = ""
			braceDepth = 0
			started = false
		}
	}

	for fn, keys := range seen {
		if len(keys) == 0 {
			continue
		}
		arr := make([]string, 0, len(keys))
		for k := range keys {
			arr = append(arr, k)
		}
		sort.Strings(arr)
		out[fn] = arr
	}

	return out
}

// ── YAML helpers ──────────────────────────────────────────────────────────────

// existingPaths parses the current spec YAML and returns the set of already-
// documented paths (line-based; no yaml dependency needed).
func existingPaths(specPath string) map[string]bool {
	f, err := os.Open(specPath)
	if err != nil {
		return map[string]bool{}
	}
	defer f.Close()

	// Accept all normal OpenAPI path keys, including templated segments like
	// /api/ext/resources/{id} and greedy segments like {id...}.
	pathKeyRe := regexp.MustCompile(`^  (/[^:\s]+):\s*$`)
	existing := map[string]bool{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		if m := pathKeyRe.FindStringSubmatch(scanner.Text()); m != nil {
			existing[strings.TrimSpace(m[1])] = true
		}
	}
	return existing
}

// methodBlock renders one HTTP method block inside a path entry.
func methodBlock(method, path, tag, auth string, queryParams []string) string {
	var buf bytes.Buffer
	lm := strings.ToLower(method)
	fmt.Fprintf(&buf, "    %s:\n", lm)
	fmt.Fprintf(&buf, "      tags: [%s]\n", tag)
	fmt.Fprintf(&buf, "      summary: %s\n", summaryFrom(method, path))
	fmt.Fprintf(&buf, "      operationId: %s\n", operationID(method, path)) // can be refined manually

	params := extractPathParams(path)
	allParams := renderParameters(params, queryParams)
	if len(allParams) > 0 {
		fmt.Fprintf(&buf, "      parameters:\n")
		for _, p := range allParams {
			fmt.Fprintf(&buf, "%s", p)
		}
	}

	if lm == "post" || lm == "put" || lm == "patch" {
		fmt.Fprintf(&buf, "      requestBody:\n")
		fmt.Fprintf(&buf, "        required: false\n")
		fmt.Fprintf(&buf, "        content:\n")
		fmt.Fprintf(&buf, "          application/json:\n")
		fmt.Fprintf(&buf, "            schema:\n")
		fmt.Fprintf(&buf, "              $ref: '#/components/schemas/GenericRequest'\n")
	}

	switch auth {
	case "superuser":
		fmt.Fprintf(&buf, "      security:\n        - bearerAuth: []  # superuser required\n")
	case "auth":
		fmt.Fprintf(&buf, "      security:\n        - bearerAuth: []\n")
	default:
		fmt.Fprintf(&buf, "      security: []  # public\n")
	}
	fmt.Fprintf(&buf, "      responses:\n")
	fmt.Fprintf(&buf, "        \"200\":\n          description: OK\n")
	fmt.Fprintf(&buf, "          content:\n")
	fmt.Fprintf(&buf, "            application/json:\n")
	fmt.Fprintf(&buf, "              schema:\n")
	fmt.Fprintf(&buf, "                $ref: '#/components/schemas/SuccessEnvelope'\n")
	if auth != "public" {
		fmt.Fprintf(&buf, "        \"401\":\n          description: Unauthorized\n")
		fmt.Fprintf(&buf, "          content:\n")
		fmt.Fprintf(&buf, "            application/json:\n")
		fmt.Fprintf(&buf, "              schema:\n")
		fmt.Fprintf(&buf, "                $ref: '#/components/schemas/ErrorEnvelope'\n")
	}
	return buf.String()
}

func renderParameters(pathParams, queryParams []string) []string {
	var out []string
	for _, p := range pathParams {
		out = append(out,
			fmt.Sprintf("        - name: %s\n", p)+
				"          in: path\n"+
				"          required: true\n"+
				"          schema:\n"+
				"            type: string\n",
		)
	}

	seen := map[string]struct{}{}
	for _, p := range pathParams {
		seen[p] = struct{}{}
	}
	for _, q := range queryParams {
		if _, ok := seen[q]; ok {
			continue
		}
		seen[q] = struct{}{}
		out = append(out,
			fmt.Sprintf("        - name: %s\n", q)+
				"          in: query\n"+
				"          required: false\n"+
				"          schema:\n"+
				"            type: string\n",
		)
	}

	return out
}

func extractPathParams(path string) []string {
	ms := rePathParam.FindAllStringSubmatch(path, -1)
	if len(ms) == 0 {
		return nil
	}
	out := make([]string, 0, len(ms))
	seen := map[string]struct{}{}
	for _, m := range ms {
		if len(m) < 2 {
			continue
		}
		name := strings.TrimSuffix(m[1], "...")
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	return out
}

func summaryFrom(method, path string) string {
	action := map[string]string{
		"GET":    "Get",
		"POST":   "Create or execute",
		"PUT":    "Update",
		"PATCH":  "Patch",
		"DELETE": "Delete",
		"HEAD":   "Head",
	}[method]

	parts := strings.Split(strings.Trim(path, "/"), "/")
	clean := make([]string, 0, len(parts))
	for _, part := range parts {
		if part == "api" || part == "ext" {
			continue
		}
		if strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}") {
			name := strings.TrimSuffix(strings.Trim(part, "{}"), "...")
			clean = append(clean, "by "+name)
			continue
		}
		clean = append(clean, strings.ReplaceAll(part, "-", " "))
	}

	return strings.TrimSpace(action + " " + strings.Join(clean, " "))
}

func operationID(method, path string) string {
	clean := strings.ToLower(path)
	clean = strings.ReplaceAll(clean, "/", "_")
	clean = strings.ReplaceAll(clean, "{", "")
	clean = strings.ReplaceAll(clean, "}", "")
	clean = strings.ReplaceAll(clean, ".", "_")
	clean = strings.Trim(clean, "_")
	return fmt.Sprintf("%s_%s", strings.ToLower(method), clean)
}

// ── main ──────────────────────────────────────────────────────────────────────

func main() {
	_, thisFile, _, _ := runtime.Caller(0)
	// thisFile = backend/cmd/gen-openapi/main.go
	root := filepath.Join(filepath.Dir(thisFile), "../..")
	routesDir := filepath.Join(root, "internal/routes")
	specPath := filepath.Join(root, "docs/openapi/ext-api.yaml")

	// Scan all route files
	files, _ := filepath.Glob(filepath.Join(routesDir, "*.go"))
	allRoutes := map[string][]string{} // path → []method (deduped)
	allSuperuserPaths := map[string]bool{}

	ops := map[string]route{} // key: METHOD + space + path
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		routes, superuserPaths := scanFile(f)
		for r, v := range superuserPaths {
			if v {
				allSuperuserPaths[r] = true
			}
		}
		for _, r := range routes {
			opKey := r.method + " " + r.path
			if _, exists := ops[opKey]; !exists {
				ops[opKey] = r
			}

			key := r.path
			for _, m := range allRoutes[key] {
				if m == r.method {
					goto next
				}
			}
			allRoutes[key] = append(allRoutes[key], r.method)
		next:
		}
	}

	// Sort paths for stable output
	paths := make([]string, 0, len(allRoutes))
	for p := range allRoutes {
		paths = append(paths, p)
	}
	sort.Strings(paths)

	// Load existing spec to find already-documented paths
	existing := existingPaths(specPath)

	// Build new path blocks for missing routes
	var newBlocks bytes.Buffer
	added := 0
	for _, p := range paths {
		if existing[p] {
			continue
		}
		tag := tagFromPath(p)
		auth := authForPath(p, allSuperuserPaths)
		methods := allRoutes[p]
		sort.Strings(methods)

		fmt.Fprintf(&newBlocks, "\n  %s:\n", p)
		for _, m := range methods {
			op := ops[m+" "+p]
			newBlocks.WriteString(methodBlock(m, p, tag, auth, op.queryParams))
		}
		added++
	}

	if added == 0 {
		fmt.Println("All routes already documented. Nothing to add.")
		return
	}

	// Append new blocks to the spec file
	// Strategy: find "paths: {}" or "paths:" and replace / append after it.
	raw, err := os.ReadFile(specPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Cannot read spec:", err)
		os.Exit(1)
	}

	var out bytes.Buffer
	// Replace "paths: {}" placeholder with "paths:" + new content
	if bytes.Contains(raw, []byte("paths: {}")) {
		out.Write(bytes.Replace(raw, []byte("paths: {}"), []byte("paths:"+newBlocks.String()), 1))
	} else {
		// Append after last line of existing paths block
		out.Write(raw)
		// Remove trailing newline and append
		content := strings.TrimRight(out.String(), "\n")
		out.Reset()
		out.WriteString(content)
		out.WriteString(newBlocks.String())
		out.WriteString("\n")
	}

	if err := os.WriteFile(specPath, out.Bytes(), 0644); err != nil {
		fmt.Fprintln(os.Stderr, "Cannot write spec:", err)
		os.Exit(1)
	}

	fmt.Printf("Generated %d new path(s) in %s\n", added, specPath)
}
