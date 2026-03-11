package routes

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/secrets"
	"github.com/websoft9/appos/backend/internal/settings"
)

// ─── Settings allowlist ────────────────────────────────────────────────────
//
// allowedModuleKeys defines which (module, key) pairs may be read/written via
// the Ext Settings API.  Unknown pairs are rejected with 400.
//
// Phase 1 (Story 13.1): space only.
// Phase 2 (Story 13.5): proxy, docker, llm added.
var allowedModuleKeys = map[string][]string{
	"space":   {"quota"},
	"proxy":   {"network"},
	"docker":  {"mirror", "registries"},
	"llm":     {"providers"},
	"connect": {"sftp", "terminal"},
}

// sensitiveFields is the set of field names that are masked on GET and
// whose "***" placeholder is preserved on PATCH.
var sensitiveFields = map[string]bool{
	"password": true,
	"apiKey":   true,
	"secret":   true,
}

// Code-level fallback maps — returned when the DB row is unavailable.
var (
	defaultProxyNetwork = map[string]any{
		"httpProxy": "", "httpsProxy": "", "noProxy": "", "username": "", "password": "",
	}
	defaultDockerMirror = map[string]any{
		"mirrors": []any{}, "insecureRegistries": []any{},
	}
	defaultDockerRegistries = map[string]any{"items": []any{}}
	defaultLLMProviders     = map[string]any{"items": []any{}}
	defaultConnectSFTP      = map[string]any{"maxUploadFiles": 10}
	defaultConnectTerminal  = map[string]any{"idleTimeoutSeconds": 1800, "maxConnections": 0}
)

func validateSpaceQuota(v map[string]any) error {
	raw, ok := v["maxUploadFiles"]
	if !ok || raw == nil {
		v["maxUploadFiles"] = 50
		return nil
	}

	maxUploadFiles := 0
	switch n := raw.(type) {
	case float64:
		if math.Trunc(n) != n {
			return fmt.Errorf("maxUploadFiles must be an integer")
		}
		maxUploadFiles = int(n)
	case int:
		maxUploadFiles = n
	case int64:
		maxUploadFiles = int(n)
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			return fmt.Errorf("maxUploadFiles must be an integer")
		}
		maxUploadFiles = int(i)
	case string:
		s := strings.TrimSpace(n)
		if s == "" {
			maxUploadFiles = 50
		} else {
			i, err := strconv.Atoi(s)
			if err != nil {
				return fmt.Errorf("maxUploadFiles must be an integer")
			}
			maxUploadFiles = i
		}
	default:
		return fmt.Errorf("maxUploadFiles must be an integer")
	}

	if maxUploadFiles < 1 || maxUploadFiles > 200 {
		return fmt.Errorf("maxUploadFiles must be between 1 and 200")
	}
	v["maxUploadFiles"] = maxUploadFiles
	return nil
}

func parseIntWithDefault(raw any, defaultValue int) (int, error) {
	if raw == nil {
		return defaultValue, nil
	}

	switch n := raw.(type) {
	case float64:
		if math.Trunc(n) != n {
			return 0, fmt.Errorf("must be an integer")
		}
		return int(n), nil
	case int:
		return n, nil
	case int64:
		return int(n), nil
	case json.Number:
		i, err := n.Int64()
		if err != nil {
			return 0, fmt.Errorf("must be an integer")
		}
		return int(i), nil
	case string:
		s := strings.TrimSpace(n)
		if s == "" {
			return defaultValue, nil
		}
		i, err := strconv.Atoi(s)
		if err != nil {
			return 0, fmt.Errorf("must be an integer")
		}
		return i, nil
	default:
		return 0, fmt.Errorf("must be an integer")
	}
}

func validateConnectTerminal(v map[string]any) map[string]string {
	errors := map[string]string{}

	idleTimeoutSeconds, err := parseIntWithDefault(v["idleTimeoutSeconds"], 1800)
	if err != nil {
		errors["idleTimeoutSeconds"] = "must be an integer"
	} else if idleTimeoutSeconds < 60 {
		errors["idleTimeoutSeconds"] = "must be >= 60"
	} else {
		v["idleTimeoutSeconds"] = idleTimeoutSeconds
	}

	maxConnections, err := parseIntWithDefault(v["maxConnections"], 0)
	if err != nil {
		errors["maxConnections"] = "must be an integer"
	} else if maxConnections < 0 {
		errors["maxConnections"] = "must be >= 0"
	} else {
		v["maxConnections"] = maxConnections
	}

	if len(errors) == 0 {
		return nil
	}
	return errors
}

// fallbackForKey returns the code-level fallback for a given (module, key) pair.
func fallbackForKey(module, key string) map[string]any {
	switch module + "/" + key {
	case "space/quota":
		return defaultSpaceQuota
	case "proxy/network":
		return defaultProxyNetwork
	case "docker/mirror":
		return defaultDockerMirror
	case "docker/registries":
		return defaultDockerRegistries
	case "llm/providers":
		return defaultLLMProviders
	case "connect/sftp":
		return defaultConnectSFTP
	case "connect/terminal":
		return defaultConnectTerminal
	}
	return map[string]any{}
}

// ─── Route registration ────────────────────────────────────────────────────

// RegisterSettings mounts the Ext Settings API on the given ServeEvent.
// Routes require superuser authentication.
func RegisterSettings(se *core.ServeEvent) {
	g := se.Router.Group("/api/settings/workspace")
	g.Bind(apis.RequireSuperuserAuth())
	g.GET("", handleExtSettingsDiscover)
	g.GET("/{module}", handleExtSettingsGet)
	g.PATCH("/{module}", handleExtSettingsPatch)
}

// ─── Mask helpers ──────────────────────────────────────────────────────────

// maskValue masks sensitive string fields in a group value map.
// It also walks an "items" array (if present) and masks sensitive fields in each item.
// Exception: secretRef pointer values (prefixed "secretRef:") are returned as-is so
// the UI can distinguish a bound secret reference from a masked plaintext value.
func maskValue(v map[string]any) map[string]any {
	out := make(map[string]any, len(v))
	for k, val := range v {
		if k == "items" {
			out[k] = maskItems(val)
		} else if sensitiveFields[k] {
			if s, ok := val.(string); ok && s != "" {
				if secrets.IsSecretRef(s) {
					// Preserve secretRef pointer — not sensitive; needed by UI.
					out[k] = s
				} else {
					out[k] = "***"
				}
			} else {
				out[k] = val
			}
		} else {
			out[k] = val
		}
	}
	return out
}

// maskItems masks sensitive fields inside each element of an items array.
func maskItems(raw any) any {
	arr, ok := raw.([]any)
	if !ok {
		return raw
	}
	out := make([]any, len(arr))
	for i, item := range arr {
		if m, ok := item.(map[string]any); ok {
			out[i] = maskValue(m)
		} else {
			out[i] = item
		}
	}
	return out
}

// ─── Preserve-"***" helpers ────────────────────────────────────────────────

// preserveSensitive overwrites "***" placeholder values in incoming with the
// corresponding stored values from existing.
// Returns the merged map (modifies incoming in-place and returns it).
func preserveSensitive(incoming, existing map[string]any) map[string]any {
	if incoming == nil {
		return incoming
	}
	for k, v := range incoming {
		if k == "items" {
			incoming[k] = preserveItemsSensitive(v, existing["items"])
		} else if sensitiveFields[k] {
			if s, ok := v.(string); ok && s == "***" {
				// Keep existing value (may itself be "***" if never set — acceptable).
				if ev, ok := existing[k]; ok {
					incoming[k] = ev
				}
			}
		}
	}
	return incoming
}

// preserveItemsSensitive merges "***" sentinels in incoming items array with
// stored values from existing items array using positional matching (index i
// in incoming maps to index i in existing).
//
// CONSTRAINT: Callers must not reorder items between successive GET and PATCH
// calls. If the UI allows reordering, passwords at position i will be resolved
// from the wrong existing entry. Currently the UI does not support drag-to-reorder.
func preserveItemsSensitive(rawIncoming, rawExisting any) any {
	inArr, ok := rawIncoming.([]any)
	if !ok {
		return rawIncoming
	}
	exArr, _ := rawExisting.([]any)
	out := make([]any, len(inArr))
	for i, item := range inArr {
		inItem, ok := item.(map[string]any)
		if !ok {
			out[i] = item
			continue
		}
		var exItem map[string]any
		if i < len(exArr) {
			exItem, _ = exArr[i].(map[string]any)
		}
		if exItem == nil {
			exItem = map[string]any{}
		}
		out[i] = preserveSensitive(inItem, exItem)
	}
	return out
}

// validateLLMProvidersSecretRefs checks any provider item whose apiKey is a
// secretRef pointer. Returns an error if the referenced secret is missing,
// revoked, or the caller lacks access.
func validateLLMProvidersSecretRefs(e *core.RequestEvent, v map[string]any) error {
	userID := ""
	if e.Auth != nil {
		userID = e.Auth.Id
	}
	items, _ := v["items"].([]any)
	for i, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			continue
		}
		apiKey, _ := m["apiKey"].(string)
		if id, ok := secrets.ExtractSecretID(apiKey); ok {
			if err := secrets.ValidateRef(e.App, id, userID); err != nil {
				return fmt.Errorf("provider[%d].apiKey secretRef invalid: %v", i, err)
			}
		}
	}
	return nil
}

// ─── Handlers ─────────────────────────────────────────────────────────────

// handleExtSettingsDiscover lists all available settings modules and their group keys.
//
// @Summary Discover settings modules
// @Description Lists all available setting modules (e.g. space, proxy, docker, llm, connect). Each entry includes the module name, its group keys, and the full URL to call. Use the returned `module` value directly as the path parameter in GET/PATCH /api/settings/workspace/{module}. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Success 200 {array} object
// @Failure 401 {object} map[string]any
// @Router /api/settings/workspace [get]
func handleExtSettingsDiscover(e *core.RequestEvent) error {
	type moduleEntry struct {
		Module string   `json:"module"`
		Keys   []string `json:"keys"`
		URL    string   `json:"url"`
	}

	// Collect and sort module names for deterministic output
	names := make([]string, 0, len(allowedModuleKeys))
	for m := range allowedModuleKeys {
		names = append(names, m)
	}
	sort.Strings(names)

	out := make([]moduleEntry, 0, len(names))
	for _, m := range names {
		out = append(out, moduleEntry{
			Module: m,
			Keys:   allowedModuleKeys[m],
			URL:    "/api/settings/workspace/" + m,
		})
	}
	return e.JSON(http.StatusOK, out)
}

// handleExtSettingsGet returns all settings groups for the given module.
// Sensitive string fields are masked to "***".
//
// @Summary Get settings module
// @Description Returns all group keys and their values for the given module. Supported modules include `space` (file quota), `proxy` (HTTP proxy), `docker` (mirrors & registries), and others — call GET /api/settings/workspace first to discover all available modules. Sensitive fields (password, apiKey, secret) are masked to "***". Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Param module path string true "settings module" Enums(space, proxy, docker, llm, connect)
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/settings/workspace/{module} [get]
func handleExtSettingsGet(e *core.RequestEvent) error {
	module := e.Request.PathValue("module")

	allowedKeys, ok := allowedModuleKeys[module]
	if !ok {
		return e.BadRequestError("unknown settings module: "+module, nil)
	}

	result := make(map[string]any, len(allowedKeys))
	for _, key := range allowedKeys {
		fb := fallbackForKey(module, key)
		v, _ := settings.GetGroup(e.App, module, key, fb)
		result[key] = maskValue(v)
	}

	return e.JSON(http.StatusOK, result)
}

// handleExtSettingsPatch updates one or more settings groups for the given module.
// For each incoming group key, "***" sentinel values are preserved from the existing DB row.
//
// @Summary Patch settings module
// @Description Partially updates settings groups for the given module. Use \"***\" to preserve existing sensitive values. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Param module path string true "settings module" Enums(space, proxy, docker, llm, connect)
// @Param body body object true "map of group key to partial settings object"
// @Success 200 {object} map[string]any "updated settings (masked)"
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 422 {object} map[string]any
// @Router /api/settings/workspace/{module} [patch]
func handleExtSettingsPatch(e *core.RequestEvent) error {
	module := e.Request.PathValue("module")

	allowedKeys, ok := allowedModuleKeys[module]
	if !ok {
		return e.BadRequestError("unknown settings module: "+module, nil)
	}

	// Parse request body as map[string]map[string]any
	var body map[string]any
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	// Validate all incoming keys before modifying anything.
	allowedSet := make(map[string]bool, len(allowedKeys))
	for _, k := range allowedKeys {
		allowedSet[k] = true
	}
	for k := range body {
		if !allowedSet[k] {
			return e.BadRequestError("unknown settings key: "+module+"/"+k, nil)
		}
	}

	// Process each group key in the request.
	for key, rawIncoming := range body {
		incomingMap, ok := rawIncoming.(map[string]any)
		if !ok {
			return e.JSON(http.StatusUnprocessableEntity, map[string]string{
				"error": "value for key '" + key + "' must be an object",
			})
		}

		// Load existing row so we can preserve "***" sentinels.
		fb := fallbackForKey(module, key)
		existing, _ := settings.GetGroup(e.App, module, key, fb)

		// Replace "***" with stored values.
		merged := preserveSensitive(incomingMap, existing)
		if module == "space" && key == "quota" {
			if err := validateSpaceQuota(merged); err != nil {
				return e.BadRequestError(err.Error(), nil)
			}
		}
		if module == "connect" && key == "terminal" {
			if validationErrors := validateConnectTerminal(merged); validationErrors != nil {
				return e.JSON(http.StatusUnprocessableEntity, map[string]any{
					"errors": validationErrors,
				})
			}
		}

		// secretRef bind-time validation for llm/providers items.
		// When an apiKey field value starts with "secretRef:<id>", verify the caller
		// has read access to the referenced secret before persisting the reference.
		if module == "llm" && key == "providers" {
			if err := validateLLMProvidersSecretRefs(e, merged); err != nil {
				return e.BadRequestError(err.Error(), nil)
			}
		}

		if err := settings.SetGroup(e.App, module, key, merged); err != nil {
			return e.InternalServerError("failed to save "+module+"/"+key, err)
		}
	}

	// Return the updated view (masked) of all groups.
	result := make(map[string]any, len(allowedKeys))
	for _, key := range allowedKeys {
		fb := fallbackForKey(module, key)
		v, _ := settings.GetGroup(e.App, module, key, fb)
		result[key] = maskValue(v)
	}

	return e.JSON(http.StatusOK, result)
}
