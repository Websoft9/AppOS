// gen-openapi scans matrix-bound route source files and fully regenerates
// backend/docs/openapi/ext-api.yaml.
//
// Usage:
//
//	go run ./cmd/openapi gen
//
// Behaviour:
//   - Uses backend/docs/openapi/group-matrix.yaml as the single source of truth
//   - Scans only route files declared in matrix groups[*].sources.extRouteFiles
//   - Includes only routes matched by matrix groups[*].extSurface patterns
//   - Infers auth type (public / auth / superuser) from .Bind() calls in source
//   - Generates a deterministic OpenAPI skeleton for matched custom API routes
//   - Overwrites ext-api.yaml on each run as the generated custom-route spec
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
	reGroupAssign        = regexp.MustCompile(`(\w+)\s*:?=\s*(\w+)\.Group\("([^"]*)"\)`)
	reRouterGroupAssign  = regexp.MustCompile(`(\w+)\s*:?=\s*(\w+)\.Router\.Group\("([^"]*)"\)`)
	reInlineGroupCall    = regexp.MustCompile(`\b(register[A-Za-z_][A-Za-z0-9_]*)\((\w+)(\.Router)?\.Group\("([^"]*)"\)\)`)
	reRouteMethod        = regexp.MustCompile(`(\w+)\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("([^"]*)"`)
	reRootRouterMethod   = regexp.MustCompile(`(\w+)\.Router\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("([^"]*)"`)
	reRouteMethodHandler = regexp.MustCompile(`(\w+)\.(GET|POST|PUT|DELETE|PATCH|HEAD)\("([^"]*)"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)`)
	reAuthBind           = regexp.MustCompile(`(\w+)\.Bind\(apis\.RequireAuth\(\)\)`)
	reSuperuserBind      = regexp.MustCompile(`(\w+)\.Bind\(apis\.RequireSuperuserAuth\(\)\)`)
	rePathParam          = regexp.MustCompile(`\{([^}]+)\}`)
	reFuncStart          = regexp.MustCompile(`^func\s*(\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(`)
	reFuncSignature      = regexp.MustCompile(`^func\s*(\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)`)
	reQueryGet           = regexp.MustCompile(`Query\(\)\.Get\("([^"]+)"\)`)
	reQueryVarAssign     = regexp.MustCompile(`([A-Za-z_][A-Za-z0-9_]*)\s*:?=\s*.*\.Query\(\)`)
	reVarGet             = regexp.MustCompile(`([A-Za-z_][A-Za-z0-9_]*)\.Get\("([^"]+)"\)`)
	reHelperQueryKey     = regexp.MustCompile(`\b(?:firstQuery|getQueryParam|queryParam)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*"([^"]+)"\s*\)`)
	reFuncQueryMapParam  = regexp.MustCompile(`([A-Za-z_][A-Za-z0-9_]*)\s+map\[string\]\[\]string`)
	reSwaggerKV          = regexp.MustCompile(`(group|summary|auth)=("[^"]+"|\S+)`)
	reSwaggerParam       = regexp.MustCompile(`@Param\s+([A-Za-z_][A-Za-z0-9_]*)\s+(path|query|header|cookie|body|formData)\s+(\S+)\s+(true|false)\b`)
	reSwaggerParamEnums  = regexp.MustCompile(`Enums\(([^)]*)\)`)
	reSwaggerSummary     = regexp.MustCompile(`@Summary\s+(.+)`)
	reSwaggerDescription = regexp.MustCompile(`@Description\s+(.+)`)
	reSwaggerSuccessCode = regexp.MustCompile(`@Success\s+([0-9]{3})\b`)
	reSwaggerFailureCode = regexp.MustCompile(`@Failure\s+([0-9]{3})\b`)
	reSwaggerResponse    = regexp.MustCompile(`@(Success|Failure)\s+([0-9]{3})\s+\{([^}]+)\}\s+(\S+)`)
	reRegisterCall       = regexp.MustCompile(`\b(register[A-Za-z_][A-Za-z0-9_]*)\((\w+)\)`)
)

// publicPrefixes: routes whose full path starts with these are unauthenticated.
var publicPrefixes = []string{
	"/api/ext/setup",
	"/api/ext/auth",
	"/api/space/preview",
	"/api/space/share",
	"/tunnel/setup",
	"/openapi",
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
	method          string
	path            string
	handler         string
	queryParams     []string
	queryRequired   map[string]bool
	queryParamHints map[string]swaggerParamHint
	pathParamHints  []swaggerParamHint
	headerParams    []swaggerParamHint
	cookieParams    []swaggerParamHint
	formDataParams  []swaggerParamHint
	bodyRequired    *bool
	bodySchema      *swaggerSchemaHint
	successCodes    []int
	failureCodes    []int
	successSchemas  map[int]swaggerSchemaHint
	failureSchemas  map[int]swaggerSchemaHint
	markerGroup     string
	markerSummary   string
	markerAuth      string
	summary         string
	description     string
	detectedAuth    string
}

type swaggerParamHint struct {
	name       string
	location   string
	dataType   string
	required   bool
	enumValues []string
}

type groupEntry struct {
	Group         string
	Description   string
	APIType       string
	ExtSurface    []string
	ExtRouteFiles []string
}

type extPattern struct {
	group       string
	method      string
	pathPattern string
	hasMethod   bool
	isWildcard  bool
}

type functionSeed struct {
	paramName string
	basePath  string
	auth      string
}

// ── per-file scanner ──────────────────────────────────────────────────────────

func scanFile(filePath string, seeds map[string]functionSeed) ([]route, map[string]bool) {
	data, _ := os.ReadFile(filePath)
	handlerQueries := extractHandlerQueryParams(string(data))
	handlerParamHints := extractHandlerParamHints(string(data))
	handlerSuccessCodes := extractHandlerSuccessCodes(string(data))
	handlerFailureCodes := extractHandlerFailureCodes(string(data))
	handlerSuccessSchemas, handlerFailureSchemas := extractHandlerResponseSchemas(string(data))
	handlerSummaries := extractHandlerSummaries(string(data))
	handlerDescriptions := extractHandlerDescriptions(string(data))

	defaultG := "/api/ext"
	if strings.HasPrefix(filepath.Base(filePath), "server") {
		defaultG = "/api/servers"
	}
	if strings.Contains(filepath.ToSlash(filePath), "/domain/certs/") {
		defaultG = "/api/certificates"
	}
	if strings.HasPrefix(filepath.Base(filePath), "terminal") {
		defaultG = "/api/terminal"
	}
	if filepath.Base(filePath) == "components.go" {
		defaultG = "/api/components"
	}
	if filepath.Base(filePath) == "deploy.go" || filepath.Base(filePath) == "apps.go" || filepath.Base(filePath) == "lifecycle_resources.go" || filepath.Base(filePath) == "catalog.go" {
		defaultG = "/api"
	}

	vars := map[string]string{
		"g":  defaultG,
		"se": "",
		"r":  "",
	}
	varAuth := map[string]string{
		"g":  "",
		"se": "",
		"r":  "",
	}
	superuserVarPaths := map[string]bool{} // resolved base path → is superuser

	var routes []route
	var pendingMarker map[string]string
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
				seeds[funcName] = functionSeed{
					basePath: basePath,
					auth:     varAuth[parent],
				}
			}
		}

		if m := reFuncSignature.FindStringSubmatch(trim); m != nil {
			funcName := m[2]
			params := m[3]
			if seed, ok := seeds[funcName]; ok {
				paramName := firstParamName(params)
				if paramName != "" {
					vars[paramName] = seed.basePath
					varAuth[paramName] = seed.auth
				}
			}
		}

		if strings.Contains(line, "@swagger") {
			pendingMarker = parseSwaggerMarker(line)
		}

		// Track Group assignments
		if m := reGroupAssign.FindStringSubmatch(line); m != nil {
			newVar, parent, suffix := m[1], m[2], m[3]
			if base, ok := vars[parent]; ok {
				vars[newVar] = base + suffix
				varAuth[newVar] = varAuth[parent]
				if varAuth[newVar] == "" {
					varAuth[newVar] = "public"
				}
			}
		}

		// Track ServeEvent router group assignments, e.g.:
		//   setup := se.Router.Group("/api/ext/setup")
		if m := reRouterGroupAssign.FindStringSubmatch(line); m != nil {
			newVar, parent, suffix := m[1], m[2], m[3]
			if base, ok := vars[parent]; ok {
				vars[newVar] = base + suffix
				varAuth[newVar] = varAuth[parent]
				if varAuth[newVar] == "" {
					varAuth[newVar] = "public"
				}
			}
		}

		if m := reAuthBind.FindStringSubmatch(line); m != nil {
			varName := m[1]
			if _, ok := vars[varName]; ok && varAuth[varName] != "superuser" {
				varAuth[varName] = "auth"
			}
		}

		// Track superuser bindings
		if m := reSuperuserBind.FindStringSubmatch(line); m != nil {
			varName := m[1]
			if base, ok := vars[varName]; ok && base != "" {
				superuserVarPaths[base] = true
				varAuth[varName] = "superuser"
			}
		}

		// Collect route registrations
		if m := reRouteMethod.FindStringSubmatch(line); m != nil {
			varName, method, suffix := m[1], m[2], m[3]
			if base, ok := vars[varName]; ok && (strings.HasPrefix(base, "/api/") || strings.HasPrefix(base, "/tunnel/setup")) {
				r := route{method: method, path: base + suffix}
				r.detectedAuth = strings.TrimSpace(varAuth[varName])
				if hm := reRouteMethodHandler.FindStringSubmatch(line); hm != nil {
					h := hm[4]
					r.handler = h
					r.queryParams = append([]string{}, handlerQueries[h]...)
					r.queryRequired = map[string]bool{}
					r.queryParamHints = map[string]swaggerParamHint{}
					r.pathParamHints = []swaggerParamHint{}
					r.headerParams = []swaggerParamHint{}
					r.cookieParams = []swaggerParamHint{}
					r.formDataParams = []swaggerParamHint{}
					r.successSchemas = map[int]swaggerSchemaHint{}
					r.failureSchemas = map[int]swaggerSchemaHint{}
					for _, p := range r.queryParams {
						r.queryRequired[p] = false
					}
					for _, hint := range handlerParamHints[h] {
						switch hint.location {
						case "path":
							r.pathParamHints = append(r.pathParamHints, hint)
						case "query":
							if _, ok := r.queryRequired[hint.name]; !ok {
								r.queryParams = append(r.queryParams, hint.name)
							}
							r.queryRequired[hint.name] = hint.required
							r.queryParamHints[hint.name] = hint
						case "body":
							required := hint.required
							r.bodyRequired = &required
							r.bodySchema = &swaggerSchemaHint{container: "object", dataType: hint.dataType}
						case "header":
							r.headerParams = append(r.headerParams, hint)
						case "cookie":
							r.cookieParams = append(r.cookieParams, hint)
						case "formData":
							r.formDataParams = append(r.formDataParams, hint)
						}
					}
					sort.Strings(r.queryParams)
					r.successCodes = handlerSuccessCodes[h]
					r.failureCodes = handlerFailureCodes[h]
					for code, hint := range handlerSuccessSchemas[h] {
						r.successSchemas[code] = hint
					}
					for code, hint := range handlerFailureSchemas[h] {
						r.failureSchemas[code] = hint
					}
					r.summary = handlerSummaries[h]
					r.description = handlerDescriptions[h]
				}
				if pendingMarker != nil {
					r.markerGroup = pendingMarker["group"]
					r.markerSummary = pendingMarker["summary"]
					r.markerAuth = pendingMarker["auth"]
					pendingMarker = nil
				}
				routes = append(routes, r)
			}
		}

		if m := reRootRouterMethod.FindStringSubmatch(line); m != nil {
			varName, method, suffix := m[1], m[2], m[3]
			if base, ok := vars[varName]; ok {
				fullPath := base + suffix
				if strings.HasPrefix(fullPath, "/api/") || strings.HasPrefix(fullPath, "/tunnel/setup") {
					routes = append(routes, route{method: method, path: fullPath, detectedAuth: authForPath(fullPath, superuserVarPaths)})
				}
			}
		}
	}
	return routes, superuserVarPaths
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

func loadRouteFunctionSeeds(routesDir string) (map[string]functionSeed, error) {
	path := filepath.Join(routesDir, "routes.go")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	vars := map[string]string{"se": ""}
	varAuth := map[string]string{"se": "public"}
	seeds := map[string]functionSeed{}

	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()

		if m := reGroupAssign.FindStringSubmatch(line); m != nil {
			newVar, parent, suffix := m[1], m[2], m[3]
			if base, ok := vars[parent]; ok {
				vars[newVar] = base + suffix
				varAuth[newVar] = varAuth[parent]
				if varAuth[newVar] == "" {
					varAuth[newVar] = "public"
				}
			}
		}

		if m := reRouterGroupAssign.FindStringSubmatch(line); m != nil {
			newVar, parent, suffix := m[1], m[2], m[3]
			if base, ok := vars[parent]; ok {
				vars[newVar] = base + suffix
				varAuth[newVar] = varAuth[parent]
				if varAuth[newVar] == "" {
					varAuth[newVar] = "public"
				}
			}
		}

		if m := reAuthBind.FindStringSubmatch(line); m != nil {
			if _, ok := vars[m[1]]; ok {
				varAuth[m[1]] = "auth"
			}
		}

		if m := reSuperuserBind.FindStringSubmatch(line); m != nil {
			if _, ok := vars[m[1]]; ok {
				varAuth[m[1]] = "superuser"
			}
		}

		if m := reRegisterCall.FindStringSubmatch(line); m != nil {
			funcName, argName := m[1], m[2]
			if basePath, ok := vars[argName]; ok && basePath != "" {
				seeds[funcName] = functionSeed{
					paramName: argName,
					basePath:  basePath,
					auth:      varAuth[argName],
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return seeds, nil
}

func extractHandlerSummaries(src string) map[string]string {
	return extractHandlerSingleAnnotation(src, reSwaggerSummary)
}

func extractHandlerDescriptions(src string) map[string]string {
	return extractHandlerSingleAnnotation(src, reSwaggerDescription)
}

func extractHandlerSingleAnnotation(src string, re *regexp.Regexp) map[string]string {
	out := map[string]string{}
	scanner := bufio.NewScanner(strings.NewReader(src))
	pending := ""
	insideBlock := false
	for scanner.Scan() {
		line := scanner.Text()
		trim := strings.TrimSpace(line)
		if trim == "" {
			if !insideBlock {
				pending = ""
			}
			continue
		}
		if strings.HasPrefix(trim, "/*") {
			insideBlock = true
		}
		if insideBlock {
			if strings.Contains(trim, "*/") {
				insideBlock = false
			}
		}
		if strings.HasPrefix(trim, "//") {
			if m := re.FindStringSubmatch(trim); m != nil {
				pending = strings.TrimSpace(m[1])
			}
			continue
		}
		if m := reFuncStart.FindStringSubmatch(trim); m != nil {
			if pending != "" {
				out[m[2]] = pending
				pending = ""
			}
			continue
		}
		pending = ""
	}
	return out
}

func extractHandlerParamHints(src string) map[string][]swaggerParamHint {
	out := map[string][]swaggerParamHint{}
	scanner := bufio.NewScanner(strings.NewReader(src))

	pendingCommentLines := make([]string, 0)
	insideBlockComment := false

	for scanner.Scan() {
		line := scanner.Text()
		trim := strings.TrimSpace(line)

		if trim == "" {
			if !insideBlockComment {
				pendingCommentLines = pendingCommentLines[:0]
			}
			continue
		}

		if insideBlockComment {
			pendingCommentLines = append(pendingCommentLines, trim)
			if strings.Contains(trim, "*/") {
				insideBlockComment = false
			}
			continue
		}

		if strings.HasPrefix(trim, "/*") {
			insideBlockComment = true
			pendingCommentLines = append(pendingCommentLines, trim)
			if strings.Contains(trim, "*/") {
				insideBlockComment = false
			}
			continue
		}

		if strings.HasPrefix(trim, "//") {
			pendingCommentLines = append(pendingCommentLines, trim)
			continue
		}

		if m := reFuncStart.FindStringSubmatch(trim); m != nil {
			fn := m[2]
			hints := parseParamHintsFromComments(pendingCommentLines)
			if len(hints) > 0 {
				out[fn] = hints
			}
			pendingCommentLines = pendingCommentLines[:0]
			continue
		}

		pendingCommentLines = pendingCommentLines[:0]
	}

	return out
}

func parseParamHintsFromComments(lines []string) []swaggerParamHint {
	if len(lines) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	out := make([]swaggerParamHint, 0)
	for _, line := range lines {
		for _, m := range reSwaggerParam.FindAllStringSubmatch(line, -1) {
			if len(m) < 5 {
				continue
			}
			name := strings.TrimSpace(m[1])
			location := strings.TrimSpace(m[2])
			dataType := strings.TrimSpace(m[3])
			required := strings.EqualFold(strings.TrimSpace(m[4]), "true")
			key := location + ":" + name + ":" + dataType
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			out = append(out, swaggerParamHint{name: name, location: location, dataType: dataType, required: required, enumValues: parseParamEnumValues(line)})
		}
	}
	return out
}

func parseParamEnumValues(line string) []string {
	m := reSwaggerParamEnums.FindStringSubmatch(line)
	if len(m) < 2 {
		return nil
	}
	parts := strings.Split(m[1], ",")
	values := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		value := strings.Trim(strings.TrimSpace(part), `"'`)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	if len(values) == 0 {
		return nil
	}
	return values
}

func extractHandlerSuccessCodes(src string) map[string][]int {
	return extractHandlerCommentCodes(src, reSwaggerSuccessCode, func(code int) bool {
		return code == 201 || code == 202 || code == 204
	})
}

func extractHandlerFailureCodes(src string) map[string][]int {
	return extractHandlerCommentCodes(src, reSwaggerFailureCode, func(code int) bool {
		return code >= 400 && code <= 599
	})
}

func extractHandlerResponseSchemas(src string) (map[string]map[int]swaggerSchemaHint, map[string]map[int]swaggerSchemaHint) {
	success := map[string]map[int]swaggerSchemaHint{}
	failure := map[string]map[int]swaggerSchemaHint{}
	scanner := bufio.NewScanner(strings.NewReader(src))

	pendingCommentLines := make([]string, 0)
	insideBlockComment := false

	for scanner.Scan() {
		line := scanner.Text()
		trim := strings.TrimSpace(line)

		if trim == "" {
			if !insideBlockComment {
				pendingCommentLines = pendingCommentLines[:0]
			}
			continue
		}

		if insideBlockComment {
			pendingCommentLines = append(pendingCommentLines, trim)
			if strings.Contains(trim, "*/") {
				insideBlockComment = false
			}
			continue
		}

		if strings.HasPrefix(trim, "/*") {
			insideBlockComment = true
			pendingCommentLines = append(pendingCommentLines, trim)
			if strings.Contains(trim, "*/") {
				insideBlockComment = false
			}
			continue
		}

		if strings.HasPrefix(trim, "//") {
			pendingCommentLines = append(pendingCommentLines, trim)
			continue
		}

		if m := reFuncStart.FindStringSubmatch(trim); m != nil {
			fn := m[2]
			successHints, failureHints := parseResponseHintsFromComments(pendingCommentLines)
			if len(successHints) > 0 {
				success[fn] = successHints
			}
			if len(failureHints) > 0 {
				failure[fn] = failureHints
			}
			pendingCommentLines = pendingCommentLines[:0]
			continue
		}

		pendingCommentLines = pendingCommentLines[:0]
	}

	return success, failure
}

func parseResponseHintsFromComments(lines []string) (map[int]swaggerSchemaHint, map[int]swaggerSchemaHint) {
	if len(lines) == 0 {
		return nil, nil
	}
	success := map[int]swaggerSchemaHint{}
	failure := map[int]swaggerSchemaHint{}
	for _, line := range lines {
		for _, m := range reSwaggerResponse.FindAllStringSubmatch(line, -1) {
			if len(m) < 5 {
				continue
			}
			code := 0
			for _, ch := range m[2] {
				code = code*10 + int(ch-'0')
			}
			hint := swaggerSchemaHint{container: strings.TrimSpace(m[3]), dataType: strings.TrimSpace(m[4])}
			if strings.EqualFold(strings.TrimSpace(m[1]), "Success") {
				success[code] = hint
				continue
			}
			failure[code] = hint
		}
	}
	if len(success) == 0 {
		success = nil
	}
	if len(failure) == 0 {
		failure = nil
	}
	return success, failure
}

func extractHandlerCommentCodes(src string, codeRegex *regexp.Regexp, accept func(int) bool) map[string][]int {
	out := map[string][]int{}
	scanner := bufio.NewScanner(strings.NewReader(src))

	pendingCommentLines := make([]string, 0)
	insideBlockComment := false

	for scanner.Scan() {
		line := scanner.Text()
		trim := strings.TrimSpace(line)

		if trim == "" {
			if !insideBlockComment {
				pendingCommentLines = pendingCommentLines[:0]
			}
			continue
		}

		if insideBlockComment {
			pendingCommentLines = append(pendingCommentLines, trim)
			if strings.Contains(trim, "*/") {
				insideBlockComment = false
			}
			continue
		}

		if strings.HasPrefix(trim, "/*") {
			insideBlockComment = true
			pendingCommentLines = append(pendingCommentLines, trim)
			if strings.Contains(trim, "*/") {
				insideBlockComment = false
			}
			continue
		}

		if strings.HasPrefix(trim, "//") {
			pendingCommentLines = append(pendingCommentLines, trim)
			continue
		}

		if m := reFuncStart.FindStringSubmatch(trim); m != nil {
			fn := m[2]
			codes := parseCodesFromComments(pendingCommentLines, codeRegex, accept)
			if len(codes) > 0 {
				out[fn] = codes
			}
			pendingCommentLines = pendingCommentLines[:0]
			continue
		}

		pendingCommentLines = pendingCommentLines[:0]
	}

	return out
}

func parseCodesFromComments(lines []string, codeRegex *regexp.Regexp, accept func(int) bool) []int {
	if len(lines) == 0 {
		return nil
	}
	set := map[int]struct{}{}
	for _, line := range lines {
		for _, m := range codeRegex.FindAllStringSubmatch(line, -1) {
			if len(m) < 2 {
				continue
			}
			code := 0
			for _, ch := range m[1] {
				code = code*10 + int(ch-'0')
			}
			if accept(code) {
				set[code] = struct{}{}
			}
		}
	}
	if len(set) == 0 {
		return nil
	}
	codes := make([]int, 0, len(set))
	for code := range set {
		codes = append(codes, code)
	}
	sort.Ints(codes)
	return codes
}

func parseSwaggerMarker(line string) map[string]string {
	idx := strings.Index(line, "@swagger")
	if idx < 0 {
		return nil
	}
	part := line[idx+len("@swagger"):]
	out := map[string]string{}
	for _, m := range reSwaggerKV.FindAllStringSubmatch(part, -1) {
		if len(m) < 3 {
			continue
		}
		k := strings.TrimSpace(m[1])
		v := strings.TrimSpace(m[2])
		v = strings.Trim(v, "\"")
		out[k] = v
	}
	if len(out) == 0 {
		return nil
	}
	return out
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
				for _, pm := range reFuncQueryMapParam.FindAllStringSubmatch(trim, -1) {
					if len(pm) >= 2 {
						queryVars := seen[currentFunc+":__query_vars"]
						if queryVars == nil {
							queryVars = map[string]struct{}{}
							seen[currentFunc+":__query_vars"] = queryVars
						}
						queryVars[pm[1]] = struct{}{}
					}
				}
			}
			continue
		}

		for _, m := range reQueryGet.FindAllStringSubmatch(line, -1) {
			if len(m) >= 2 {
				seen[currentFunc][m[1]] = struct{}{}
			}
		}

		queryVars := seen[currentFunc+":__query_vars"]
		if queryVars == nil {
			queryVars = map[string]struct{}{}
			seen[currentFunc+":__query_vars"] = queryVars
		}

		for _, m := range reQueryVarAssign.FindAllStringSubmatch(line, -1) {
			if len(m) >= 2 {
				queryVars[m[1]] = struct{}{}
			}
		}

		for _, m := range reVarGet.FindAllStringSubmatch(line, -1) {
			if len(m) >= 3 {
				if _, ok := queryVars[m[1]]; ok {
					seen[currentFunc][m[2]] = struct{}{}
				}
			}
		}

		for _, m := range reHelperQueryKey.FindAllStringSubmatch(line, -1) {
			if len(m) >= 3 {
				if _, ok := queryVars[m[1]]; ok {
					seen[currentFunc][m[2]] = struct{}{}
				}
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
		if strings.HasSuffix(fn, ":__query_vars") {
			continue
		}
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

func loadGroupMatrix(path string) ([]groupEntry, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	lines := strings.Split(string(data), "\n")
	entries := make([]groupEntry, 0)
	var current *groupEntry
	inExtSurface := false
	inSources := false
	inExtRouteFiles := false

	flush := func() {
		if current == nil {
			return
		}
		entries = append(entries, *current)
		current = nil
		inExtSurface = false
	}

	for _, raw := range lines {
		line := strings.TrimRight(raw, "\r")
		trim := strings.TrimSpace(line)

		if strings.HasPrefix(line, "  - group:") {
			flush()
			current = &groupEntry{Group: strings.TrimSpace(strings.TrimPrefix(line, "  - group:"))}
			continue
		}
		if current == nil {
			continue
		}

		if strings.HasPrefix(line, "    description:") {
			current.Description = strings.TrimSpace(strings.TrimPrefix(line, "    description:"))
			inExtSurface = false
			continue
		}
		if strings.HasPrefix(line, "    apiType:") {
			current.APIType = strings.TrimSpace(strings.TrimPrefix(line, "    apiType:"))
			inExtSurface = false
			continue
		}
		if strings.HasPrefix(line, "    extSurface:") {
			inExtSurface = true
			inSources = false
			inExtRouteFiles = false
			continue
		}
		if strings.HasPrefix(line, "    sources:") {
			inSources = true
			inExtSurface = false
			inExtRouteFiles = false
			continue
		}
		if inSources && strings.HasPrefix(line, "      extRouteFiles:") {
			inExtRouteFiles = true
			continue
		}

		if inExtSurface && strings.HasPrefix(line, "      - ") {
			current.ExtSurface = append(current.ExtSurface, strings.TrimSpace(strings.TrimPrefix(line, "      - ")))
			continue
		}
		if inExtRouteFiles && strings.HasPrefix(line, "        - ") {
			current.ExtRouteFiles = append(current.ExtRouteFiles, strings.TrimSpace(strings.TrimPrefix(line, "        - ")))
			continue
		}

		if inExtSurface && strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "      ") {
			inExtSurface = false
		}
		if inExtRouteFiles && strings.HasPrefix(line, "      ") && !strings.HasPrefix(line, "        ") {
			inExtRouteFiles = false
		}
		if inSources && strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "      ") {
			inSources = false
			inExtRouteFiles = false
		}

		if trim == "" {
			continue
		}
	}
	flush()
	return entries, nil
}

func parseSurface(surface string) (method string, path string, hasMethod bool) {
	s := strings.TrimSpace(surface)
	if s == "" {
		return "", "", false
	}
	parts := strings.Fields(s)
	if len(parts) >= 2 {
		candidate := strings.ToUpper(strings.TrimSpace(parts[0]))
		switch candidate {
		case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD":
			return candidate, strings.TrimSpace(parts[1]), true
		}
	}
	return "", s, false
}

func buildExtPatterns(groups []groupEntry) []extPattern {
	patterns := make([]extPattern, 0)
	for _, group := range groups {
		apiType := strings.ToLower(strings.TrimSpace(group.APIType))
		if apiType != "ext" && apiType != "mixed" {
			continue
		}
		for _, surface := range group.ExtSurface {
			method, path, hasMethod := parseSurface(surface)
			patterns = append(patterns, extPattern{
				group:       strings.TrimSpace(group.Group),
				method:      method,
				pathPattern: path,
				hasMethod:   hasMethod,
				isWildcard:  strings.HasSuffix(path, "*"),
			})
		}
	}
	return patterns
}

func scorePattern(pattern extPattern, method string, path string) int {
	if pattern.hasMethod && pattern.method != method {
		return -1
	}

	if pattern.isWildcard {
		prefix := strings.TrimSuffix(pattern.pathPattern, "*")
		base := strings.TrimSuffix(prefix, "/")
		if path == base || strings.HasPrefix(path, prefix) {
			score := 1000 + len(base)
			if pattern.hasMethod {
				score += 100
			}
			return score
		}
		return -1
	}

	if path != pattern.pathPattern {
		return -1
	}

	score := 2000 + len(pattern.pathPattern)
	if pattern.hasMethod {
		score += 100
	}
	return score
}

func tagFromMatrix(method string, path string, patterns []extPattern) (string, bool) {
	bestScore := -1
	bestGroup := ""
	for _, pattern := range patterns {
		score := scorePattern(pattern, method, path)
		if score > bestScore {
			bestScore = score
			bestGroup = pattern.group
		}
	}
	if bestScore < 0 || bestGroup == "" {
		return "", false
	}
	return bestGroup, true
}

func extTagsFromMatrix(groups []groupEntry) []groupEntry {
	out := make([]groupEntry, 0)
	seen := map[string]struct{}{}
	for _, group := range groups {
		apiType := strings.ToLower(strings.TrimSpace(group.APIType))
		if apiType != "ext" && apiType != "mixed" {
			continue
		}
		hasExtSurface := len(group.ExtSurface) > 0
		if !hasExtSurface {
			continue
		}
		name := strings.TrimSpace(group.Group)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, group)
	}
	sort.Slice(out, func(i, j int) bool {
		return strings.ToLower(strings.TrimSpace(out[i].Group)) < strings.ToLower(strings.TrimSpace(out[j].Group))
	})
	return out
}

func routeFilesFromMatrix(routesDir string, groups []groupEntry) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0)
	for _, group := range groups {
		apiType := strings.ToLower(strings.TrimSpace(group.APIType))
		if apiType != "ext" && apiType != "mixed" {
			continue
		}
		for _, f := range group.ExtRouteFiles {
			name := strings.TrimSpace(f)
			if name == "" {
				continue
			}
			if !strings.HasSuffix(name, ".go") {
				name += ".go"
			}
			if _, ok := seen[name]; ok {
				continue
			}
			abs := filepath.Join(routesDir, name)
			if _, err := os.Stat(abs); err != nil {
				return nil, fmt.Errorf("matrix route file not found: %s", abs)
			}
			seen[name] = struct{}{}
			out = append(out, abs)
		}
	}
	sort.Strings(out)
	return out, nil
}

// ── YAML helpers ──────────────────────────────────────────────────────────────

// methodBlock renders one HTTP method block inside a path entry.
func methodBlock(method, path, tag, auth string, queryParams []string, queryRequired map[string]bool, queryParamHints map[string]swaggerParamHint, pathParamHints []swaggerParamHint, headerParams []swaggerParamHint, cookieParams []swaggerParamHint, formDataParams []swaggerParamHint, bodyRequired *bool, bodySchema *swaggerSchemaHint, successCodes []int, failureCodes []int, successSchemas map[int]swaggerSchemaHint, failureSchemas map[int]swaggerSchemaHint, componentNames map[string]string) string {
	var buf bytes.Buffer
	lm := strings.ToLower(method)
	fmt.Fprintf(&buf, "    %s:\n", lm)
	fmt.Fprintf(&buf, "      tags: [%s]\n", tag)
	fmt.Fprintf(&buf, "      summary: %s\n", summaryFrom(method, path))
	fmt.Fprintf(&buf, "      operationId: %s\n", operationID(method, path)) // can be refined manually

	params := extractPathParams(path)
	allParams := renderParameters(params, queryParams, queryRequired, queryParamHints, pathParamHints, headerParams, cookieParams)
	if len(allParams) > 0 {
		fmt.Fprintf(&buf, "      parameters:\n")
		for _, p := range allParams {
			fmt.Fprintf(&buf, "%s", p)
		}
	}

	if lm == "post" || lm == "put" || lm == "patch" {
		if len(formDataParams) > 0 {
			renderMultipartRequestBody(&buf, formDataParams)
		} else {
			required := false
			if bodyRequired != nil {
				required = *bodyRequired
			}
			fmt.Fprintf(&buf, "      requestBody:\n")
			fmt.Fprintf(&buf, "        required: %t\n", required)
			fmt.Fprintf(&buf, "        content:\n")
			fmt.Fprintf(&buf, "          application/json:\n")
			fmt.Fprintf(&buf, "            schema:\n")
			renderSchemaRef(&buf, "              ", bodySchema, componentNames, "GenericRequest")
		}
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
	hasExplicitSuccess := len(successCodes) > 0 || len(successSchemas) > 0
	if !hasExplicitSuccess || hasStatusCode(successCodes, 200) || hasResponseSchema(successSchemas, 200) {
		fmt.Fprintf(&buf, "        \"200\":\n          description: OK\n")
		fmt.Fprintf(&buf, "          content:\n")
		fmt.Fprintf(&buf, "            application/json:\n")
		fmt.Fprintf(&buf, "              schema:\n")
		if successSchemas != nil {
			if hint, ok := successSchemas[200]; ok {
				renderSchemaRef(&buf, "                ", &hint, componentNames, "SuccessEnvelope")
			} else {
				renderSchemaRef(&buf, "                ", nil, componentNames, "SuccessEnvelope")
			}
		} else {
			renderSchemaRef(&buf, "                ", nil, componentNames, "SuccessEnvelope")
		}
	}
	for _, code := range successCodes {
		if code == 200 {
			continue
		}
		fmt.Fprintf(&buf, "        \"%d\":\n          description: %s\n", code, httpStatusDescription(code))
		if code != 204 {
			fmt.Fprintf(&buf, "          content:\n")
			fmt.Fprintf(&buf, "            application/json:\n")
			fmt.Fprintf(&buf, "              schema:\n")
			if hint, ok := successSchemas[code]; ok {
				renderSchemaRef(&buf, "                ", &hint, componentNames, "SuccessEnvelope")
			} else {
				renderSchemaRef(&buf, "                ", nil, componentNames, "SuccessEnvelope")
			}
		}
	}
	if auth != "public" {
		fmt.Fprintf(&buf, "        \"401\":\n          description: Unauthorized\n")
		fmt.Fprintf(&buf, "          content:\n")
		fmt.Fprintf(&buf, "            application/json:\n")
		fmt.Fprintf(&buf, "              schema:\n")
		fmt.Fprintf(&buf, "                $ref: '#/components/schemas/ErrorEnvelope'\n")
	}
	for _, code := range failureCodes {
		if code == 401 && auth != "public" {
			continue
		}
		fmt.Fprintf(&buf, "        \"%d\":\n          description: %s\n", code, httpStatusDescription(code))
		fmt.Fprintf(&buf, "          content:\n")
		fmt.Fprintf(&buf, "            application/json:\n")
		fmt.Fprintf(&buf, "              schema:\n")
		if hint, ok := failureSchemas[code]; ok {
			renderSchemaRef(&buf, "                ", &hint, componentNames, "ErrorEnvelope")
		} else {
			renderSchemaRef(&buf, "                ", nil, componentNames, "ErrorEnvelope")
		}
	}
	return buf.String()
}

func httpStatusDescription(code int) string {
	switch code {
	case 201:
		return "Created"
	case 202:
		return "Accepted"
	case 204:
		return "No Content"
	case 400:
		return "Bad Request"
	case 401:
		return "Unauthorized"
	case 403:
		return "Forbidden"
	case 404:
		return "Not Found"
	case 409:
		return "Conflict"
	case 413:
		return "Payload Too Large"
	case 415:
		return "Unsupported Media Type"
	case 422:
		return "Unprocessable Entity"
	case 429:
		return "Too Many Requests"
	case 500:
		return "Internal Server Error"
	case 502:
		return "Bad Gateway"
	case 503:
		return "Service Unavailable"
	case 504:
		return "Gateway Timeout"
	default:
		if code >= 500 {
			return "Server Error"
		}
		return "Client Error"
	}
}

func hasStatusCode(codes []int, want int) bool {
	for _, code := range codes {
		if code == want {
			return true
		}
	}
	return false
}

func hasResponseSchema(schemas map[int]swaggerSchemaHint, want int) bool {
	if schemas == nil {
		return false
	}
	_, ok := schemas[want]
	return ok
}

func renderParameters(pathParams, queryParams []string, queryRequired map[string]bool, queryParamHints map[string]swaggerParamHint, pathParamHints []swaggerParamHint, headerParams []swaggerParamHint, cookieParams []swaggerParamHint) []string {
	var out []string
	pathHints := hintsByName(pathParamHints)
	for _, p := range pathParams {
		hint := pathHints[p]
		out = append(out,
			fmt.Sprintf("        - name: %s\n", p)+
				"          in: path\n"+
				"          required: true\n"+
				"          schema:\n"+
				renderParameterSchema(hint.dataType, hint.enumValues),
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
		required := false
		if queryRequired != nil {
			required = queryRequired[q]
		}
		hint := swaggerParamHint{dataType: "string"}
		if queryParamHints != nil {
			if value, ok := queryParamHints[q]; ok {
				hint = value
			}
		}
		out = append(out,
			fmt.Sprintf("        - name: %s\n", q)+
				"          in: query\n"+
				fmt.Sprintf("          required: %t\n", required)+
				"          schema:\n"+
				renderParameterSchema(hint.dataType, hint.enumValues),
		)
	}

	for _, p := range dedupeParamHints(headerParams) {
		required := p.required
		out = append(out,
			fmt.Sprintf("        - name: %s\n", p.name)+
				"          in: header\n"+
				fmt.Sprintf("          required: %t\n", required)+
				"          schema:\n"+
				renderSimpleSchemaLine(p.dataType),
		)
	}

	for _, p := range dedupeParamHints(cookieParams) {
		required := p.required
		out = append(out,
			fmt.Sprintf("        - name: %s\n", p.name)+
				"          in: cookie\n"+
				fmt.Sprintf("          required: %t\n", required)+
				"          schema:\n"+
				renderSimpleSchemaLine(p.dataType),
		)
	}

	return out
}

func hintsByName(params []swaggerParamHint) map[string]swaggerParamHint {
	out := map[string]swaggerParamHint{}
	for _, p := range dedupeParamHints(params) {
		out[p.name] = p
	}
	return out
}

func renderParameterSchema(swaggerType string, enumValues []string) string {
	var buf strings.Builder
	dataType := swaggerType
	if strings.TrimSpace(dataType) == "" {
		dataType = "string"
	}
	fmt.Fprintf(&buf, "            type: %s\n", mapSwaggerTypeToOpenAPI(dataType))
	if len(enumValues) > 0 {
		buf.WriteString("            enum:\n")
		for _, value := range enumValues {
			fmt.Fprintf(&buf, "              - %s\n", yamlQuotedScalar(value))
		}
	}
	return buf.String()
}

func dedupeParamHints(params []swaggerParamHint) []swaggerParamHint {
	if len(params) == 0 {
		return nil
	}
	merged := map[string]swaggerParamHint{}
	for _, p := range params {
		key := p.location + ":" + p.name
		if existing, ok := merged[key]; ok {
			existing.required = existing.required || p.required
			if existing.dataType == "" {
				existing.dataType = p.dataType
			}
			merged[key] = existing
			continue
		}
		merged[key] = p
	}
	keys := make([]string, 0, len(merged))
	for k := range merged {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]swaggerParamHint, 0, len(keys))
	for _, k := range keys {
		out = append(out, merged[k])
	}
	return out
}

func renderSimpleSchemaLine(swaggerType string) string {
	typeName := mapSwaggerTypeToOpenAPI(swaggerType)
	return fmt.Sprintf("            type: %s\n", typeName)
}

func mapSwaggerTypeToOpenAPI(swaggerType string) string {
	t := strings.ToLower(strings.TrimSpace(swaggerType))
	switch t {
	case "int", "int32", "int64", "integer", "uint", "uint32", "uint64":
		return "integer"
	case "number", "float", "float32", "float64", "double":
		return "number"
	case "bool", "boolean":
		return "boolean"
	default:
		return "string"
	}
}

func renderMultipartRequestBody(buf *bytes.Buffer, formDataParams []swaggerParamHint) {
	params := dedupeParamHints(formDataParams)
	requiredList := make([]string, 0)
	fmt.Fprintf(buf, "      requestBody:\n")
	fmt.Fprintf(buf, "        required: true\n")
	fmt.Fprintf(buf, "        content:\n")
	fmt.Fprintf(buf, "          multipart/form-data:\n")
	fmt.Fprintf(buf, "            schema:\n")
	fmt.Fprintf(buf, "              type: object\n")
	fmt.Fprintf(buf, "              properties:\n")
	for _, p := range params {
		fmt.Fprintf(buf, "                %s:\n", p.name)
		t := strings.ToLower(strings.TrimSpace(p.dataType))
		if t == "file" {
			fmt.Fprintf(buf, "                  type: string\n")
			fmt.Fprintf(buf, "                  format: binary\n")
		} else {
			fmt.Fprintf(buf, "                  type: %s\n", mapSwaggerTypeToOpenAPI(p.dataType))
		}
		if p.required {
			requiredList = append(requiredList, p.name)
		}
	}
	if len(requiredList) > 0 {
		sort.Strings(requiredList)
		fmt.Fprintf(buf, "              required:\n")
		for _, name := range requiredList {
			fmt.Fprintf(buf, "                - %s\n", name)
		}
	}
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

func sanitizeContentText(raw string) string {
	text := strings.TrimSpace(raw)
	if text == "" {
		return ""
	}
	text = strings.ReplaceAll(text, ":", " ")
	text = strings.ReplaceAll(text, "：", " ")
	text = strings.Join(strings.Fields(text), " ")
	return text
}

func yamlQuotedScalar(raw string) string {
	text := strings.TrimSpace(raw)
	text = strings.ReplaceAll(text, `\`, `\\`)
	text = strings.ReplaceAll(text, `"`, `\"`)
	return "\"" + text + "\""
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

func runGen() error {
	_, thisFile, _, _ := runtime.Caller(0)
	// thisFile = backend/cmd/openapi/gen.go
	root := filepath.Join(filepath.Dir(thisFile), "../..")
	routesDir := filepath.Join(root, "domain/routes")
	specPath := filepath.Join(root, "docs/openapi/ext-api.yaml")
	groupMatrixPath := filepath.Join(root, "docs/openapi/group-matrix.yaml")

	groups, err := loadGroupMatrix(groupMatrixPath)
	if err != nil {
		return fmt.Errorf("cannot read group matrix: %w", err)
	}
	patterns := buildExtPatterns(groups)
	tags := extTagsFromMatrix(groups)
	files, err := routeFilesFromMatrix(routesDir, groups)
	if err != nil {
		return fmt.Errorf("cannot resolve matrix route files: %w", err)
	}
	functionSeeds, err := loadRouteFunctionSeeds(routesDir)
	if err != nil {
		return fmt.Errorf("cannot resolve route function seeds: %w", err)
	}
	schemaFiles, err := parseDirsForSchemas(files)
	if err != nil {
		return fmt.Errorf("cannot resolve schema files: %w", err)
	}

	// Scan only matrix-declared route files
	allRoutes := map[string][]string{} // path → []method (deduped)
	allSuperuserPaths := map[string]bool{}

	ops := map[string]route{} // key: METHOD + space + path
	for _, f := range files {
		routes, superuserPaths := scanFile(f, functionSeeds)
		for r, v := range superuserPaths {
			if v {
				allSuperuserPaths[r] = true
			}
		}
		for _, r := range routes {
			if _, ok := tagFromMatrix(r.method, r.path, patterns); !ok {
				continue
			}
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
	schemaRefs := collectSchemaTypeRefs(ops)
	schemaBlocks, componentNames, err := buildSchemaComponents(schemaFiles, schemaRefs)
	if err != nil {
		return fmt.Errorf("cannot build schema components: %w", err)
	}

	// Sort paths for stable output
	paths := make([]string, 0, len(allRoutes))
	for p := range allRoutes {
		paths = append(paths, p)
	}
	sort.Strings(paths)

	var out bytes.Buffer
	out.WriteString("openapi: \"3.0.3\"\n\n")
	out.WriteString("info:\n")
	out.WriteString("  title: AppOS API\n")
	out.WriteString("  description: >\n")
	out.WriteString("    Machine-generated OpenAPI specification for AppOS custom API routes, using group-matrix as the single source of truth.\n")
	out.WriteString("  version: \"0.1.0\"\n\n")
	out.WriteString("tags:\n")
	for _, tag := range tags {
		name := strings.TrimSpace(tag.Group)
		desc := sanitizeContentText(tag.Description)
		if name == "" {
			continue
		}
		fmt.Fprintf(&out, "  - name: %s\n", name)
		if desc != "" {
			fmt.Fprintf(&out, "    description: %s\n", yamlQuotedScalar(desc))
		}
	}
	out.WriteString("\n")
	out.WriteString("components:\n")
	out.WriteString("  securitySchemes:\n")
	out.WriteString("    bearerAuth:\n")
	out.WriteString("      type: http\n")
	out.WriteString("      scheme: bearer\n")
	out.WriteString("      bearerFormat: PocketBase token\n")
	out.WriteString("  schemas:\n")
	out.WriteString("    GenericRequest:\n")
	out.WriteString("      type: object\n")
	out.WriteString("      additionalProperties: true\n")
	out.WriteString("      description: Generic request payload placeholder (refine per endpoint)\n")
	out.WriteString("    SuccessEnvelope:\n")
	out.WriteString("      type: object\n")
	out.WriteString("      additionalProperties: true\n")
	out.WriteString("      description: Generic success payload envelope\n")
	out.WriteString("      example:\n")
	out.WriteString("        ok: true\n")
	out.WriteString("    ErrorEnvelope:\n")
	out.WriteString("      type: object\n")
	out.WriteString("      properties:\n")
	out.WriteString("        code:\n")
	out.WriteString("          type: integer\n")
	out.WriteString("        message:\n")
	out.WriteString("          type: string\n")
	out.WriteString("      required: [message]\n\n")
	for _, block := range schemaBlocks {
		out.WriteString(block)
	}
	if len(schemaBlocks) > 0 {
		out.WriteString("\n")
	}
	out.WriteString("# This file is generated by backend/cmd/openapi/gen.go\n")
	out.WriteString("# Do not edit manually. Edit routes source and re-run: make openapi-gen\n")
	out.WriteString("paths:")
	if len(paths) == 0 {
		out.WriteString(" {}\n")
	} else {
		out.WriteString("\n")
		for _, p := range paths {
			auth := authForPath(p, allSuperuserPaths)
			methods := allRoutes[p]
			sort.Strings(methods)

			fmt.Fprintf(&out, "  %s:\n", p)
			for _, m := range methods {
				op := ops[m+" "+p]
				resolvedTag, _ := tagFromMatrix(m, p, patterns)
				resolvedAuth := auth
				if strings.TrimSpace(op.detectedAuth) != "" {
					resolvedAuth = strings.TrimSpace(op.detectedAuth)
				}
				if strings.TrimSpace(op.markerAuth) != "" {
					resolvedAuth = strings.TrimSpace(op.markerAuth)
				}

				block := methodBlock(m, p, resolvedTag, resolvedAuth, op.queryParams, op.queryRequired, op.queryParamHints, op.pathParamHints, op.headerParams, op.cookieParams, op.formDataParams, op.bodyRequired, op.bodySchema, op.successCodes, op.failureCodes, op.successSchemas, op.failureSchemas, componentNames)
				// Override summary: prefer @Summary annotation, then @swagger marker, then auto-generated
				resolvedSummary := summaryFrom(m, p)
				if strings.TrimSpace(op.summary) != "" {
					resolvedSummary = strings.TrimSpace(op.summary)
				} else if strings.TrimSpace(op.markerSummary) != "" {
					resolvedSummary = strings.TrimSpace(op.markerSummary)
				}
				resolvedSummary = sanitizeContentText(resolvedSummary)
				block = strings.Replace(block, "      summary: "+summaryFrom(m, p), "      summary: "+resolvedSummary, 1)
				// Inject description after summary line if @Description is set
				if strings.TrimSpace(op.description) != "" {
					desc := sanitizeContentText(op.description)
					block = strings.Replace(block, "      summary: "+resolvedSummary+"\n", "      summary: "+resolvedSummary+"\n      description: "+yamlQuotedScalar(desc)+"\n", 1)
				}
				out.WriteString(block)
			}
		}
	}

	if err := os.WriteFile(specPath, out.Bytes(), 0600); err != nil {
		return fmt.Errorf("cannot write ext spec: %w", err)
	}

	fmt.Printf("Generated %d path(s) in %s\n", len(paths), specPath)
	return nil
}
