package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
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
	"space":  {"quota"},
	"proxy":  {"network"},
	"docker": {"mirror", "registries"},
	"llm":    {"providers"},
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
)

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
	}
	return map[string]any{}
}

// ─── Route registration ────────────────────────────────────────────────────

// RegisterSettings mounts the Ext Settings API on the given ServeEvent.
// Routes require superuser authentication.
func RegisterSettings(se *core.ServeEvent) {
	g := se.Router.Group("/api/ext/settings")
	g.Bind(apis.RequireSuperuserAuth())
	g.GET("/{module}", handleExtSettingsGet)
	g.PATCH("/{module}", handleExtSettingsPatch)
}

// ─── Mask helpers ──────────────────────────────────────────────────────────

// maskValue masks sensitive string fields in a group value map.
// It also walks an "items" array (if present) and masks sensitive fields in each item.
func maskValue(v map[string]any) map[string]any {
	out := make(map[string]any, len(v))
	for k, val := range v {
		if k == "items" {
			out[k] = maskItems(val)
		} else if sensitiveFields[k] {
			if s, ok := val.(string); ok && s != "" {
				out[k] = "***"
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

// ─── Handlers ─────────────────────────────────────────────────────────────

// handleExtSettingsGet returns all settings groups for the given module.
// Sensitive string fields are masked to "***".
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
