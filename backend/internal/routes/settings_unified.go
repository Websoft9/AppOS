package routes

import (
	"net/http"
	"sort"

	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/forms"
	"github.com/websoft9/appos/backend/internal/secrets"
	"github.com/websoft9/appos/backend/internal/settings"
	settingscatalog "github.com/websoft9/appos/backend/internal/settings/catalog"
)

func getSettingsEntrySchema(entryID string) (settingscatalog.EntrySchema, bool) {
	return settingscatalog.FindEntry(entryID)
}

func getAppSettingsEntryValue(app core.App, module, key string) (map[string]any, error) {
	fallback := fallbackForKey(module, key)
	value, err := settings.GetGroup(app, module, key, fallback)
	if module == secrets.SettingsModule && key == secrets.PolicySettingsKey {
		value = secrets.NormalizePolicy(value).ToMap()
	}
	_ = err
	return maskValue(value), nil
}

func patchAppSettingsEntry(e *core.RequestEvent, module, key string, value map[string]any) (map[string]any, error) {
	fallback := fallbackForKey(module, key)
	existing, _ := settings.GetGroup(e.App, module, key, fallback)
	merged := preserveSensitive(value, existing)

	if validationErrors := validateAppSettingsEntry(e, module, key, merged); validationErrors != nil {
		return nil, &settingsValidationError{Fields: validationErrors}
	}

	if err := settings.SetGroup(e.App, module, key, merged); err != nil {
		return nil, err
	}

	stored, err := getAppSettingsEntryValue(e.App, module, key)
	if err != nil {
		return stored, nil
	}
	return stored, nil
}

type settingsValidationError struct {
	Fields map[string]string
}

func (e *settingsValidationError) Error() string {
	return "settings validation failed"
}

func validateAppSettingsEntry(e *core.RequestEvent, module, key string, value map[string]any) map[string]string {
	switch module + "/" + key {
	case "space/quota":
		if err := validateSpaceQuota(value); err != nil {
			return map[string]string{"maxUploadFiles": err.Error()}
		}
	case "connect/terminal":
		return validateConnectTerminal(value)
	case "tunnel/port_range":
		return validateTunnelPortRange(value)
	case "deploy/preflight":
		return validateDeployPreflight(value)
	case "files/limits":
		return validateIacFiles(value)
	case "secrets/policy":
		if validationErrors := secrets.ValidatePolicy(value); validationErrors != nil {
			return validationErrors
		}
		normalized := secrets.NormalizePolicy(value).ToMap()
		for field, fieldValue := range normalized {
			value[field] = fieldValue
		}
	case "llm/providers":
		if err := validateLLMProvidersSecretRefs(e, value); err != nil {
			return map[string]string{"items": err.Error()}
		}
	}
	return nil
}

// handleSettingsSchema returns the backend-defined settings catalog for the dashboard.
//
// @Summary Get settings schema
// @Description Returns all available settings entries and actions, including their section, source, fields, and action bindings. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/settings/schema [get]
func handleSettingsSchema(e *core.RequestEvent) error {
	entries := settingscatalog.Entries()
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Section == entries[j].Section {
			return entries[i].Title < entries[j].Title
		}
		return entries[i].Section < entries[j].Section
	})

	actions := settingscatalog.Actions()
	sort.Slice(actions, func(i, j int) bool { return actions[i].Title < actions[j].Title })

	return e.JSON(http.StatusOK, map[string]any{
		"entries": entries,
		"actions": actions,
	})
}

// handleSettingsEntriesList returns the current values for all settings entries.
//
// @Summary List settings entries
// @Description Returns all settings entries with their current masked or normalized values. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/settings/entries [get]
func handleSettingsEntriesList(e *core.RequestEvent) error {
	entries := settingscatalog.Entries()
	items := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		value, err := loadSettingsEntryValue(e.App, entry)
		if err != nil {
			return e.InternalServerError("failed to load settings entry "+entry.ID, err)
		}
		items = append(items, map[string]any{
			"id":    entry.ID,
			"value": value,
		})
	}
	return e.JSON(http.StatusOK, map[string]any{"items": items})
}

// handleSettingsEntryGet returns one settings entry by its unified identifier.
//
// @Summary Get settings entry
// @Description Returns the current masked or normalized value for a single settings entry. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Param entryId path string true "settings entry id"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/settings/entries/{entryId} [get]
func handleSettingsEntryGet(e *core.RequestEvent) error {
	entryID := e.Request.PathValue("entryId")
	entry, ok := getSettingsEntrySchema(entryID)
	if !ok {
		return e.BadRequestError("unknown settings entry: "+entryID, nil)
	}

	value, err := loadSettingsEntryValue(e.App, entry)
	if err != nil {
		return e.InternalServerError("failed to load settings entry "+entryID, err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":    entryID,
		"value": value,
	})
}

// handleSettingsEntryPatch updates one settings entry by its unified identifier.
//
// @Summary Patch settings entry
// @Description Updates a single settings entry while preserving masking, defaults, and validation rules for its source. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Param entryId path string true "settings entry id"
// @Param body body object true "settings entry payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 422 {object} map[string]any
// @Router /api/settings/entries/{entryId} [patch]
func handleSettingsEntryPatch(e *core.RequestEvent) error {
	entryID := e.Request.PathValue("entryId")
	entry, ok := getSettingsEntrySchema(entryID)
	if !ok {
		return e.BadRequestError("unknown settings entry: "+entryID, nil)
	}

	var body map[string]any
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	value, err := patchSettingsEntryValue(e, entry, body)
	if err != nil {
		if fieldErr, ok := err.(*settingsValidationError); ok {
			return e.JSON(http.StatusUnprocessableEntity, map[string]any{"errors": fieldErr.Fields})
		}
		return e.BadRequestError("failed to update settings entry "+entryID, err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":    entryID,
		"value": value,
	})
}

func loadSettingsEntryValue(app core.App, entry settingscatalog.EntrySchema) (map[string]any, error) {
	if entry.Source == settingscatalog.SourcePocketBase {
		return settings.LoadPocketBaseEntry(app, entry)
	}
	return getAppSettingsEntryValue(app, entry.Module, entry.Key)
}

func patchSettingsEntryValue(e *core.RequestEvent, entry settingscatalog.EntrySchema, value map[string]any) (map[string]any, error) {
	if entry.Source == settingscatalog.SourcePocketBase {
		return settings.PatchPocketBaseEntry(e.App, entry, value)
	}
	return patchAppSettingsEntry(e, entry.Module, entry.Key, value)
}

// handleSettingsAction executes a settings-related action bound to a schema entry.
//
// @Summary Execute settings action
// @Description Executes a supported settings action such as SMTP or S3 connectivity tests. Superuser only.
// @Tags Settings
// @Security BearerAuth
// @Param actionId path string true "settings action id"
// @Param body body object true "settings action payload"
// @Success 204 {object} nil
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/settings/actions/{actionId} [post]
func handleSettingsAction(e *core.RequestEvent) error {
	actionID := e.Request.PathValue("actionId")
	switch actionID {
	case "test-s3":
		form := forms.NewTestS3Filesystem(e.App)
		if err := e.BindBody(form); err != nil {
			return e.BadRequestError("An error occurred while loading the submitted data.", err)
		}
		if err := form.Submit(); err != nil {
			if fieldErr, ok := err.(validation.Errors); ok {
				return e.BadRequestError("Failed to test the S3 filesystem.", fieldErr)
			}
			return e.BadRequestError("Failed to test the S3 filesystem. Raw error: \n"+err.Error(), nil)
		}
		return e.NoContent(http.StatusNoContent)
	case "test-email":
		form := forms.NewTestEmailSend(e.App)
		if err := e.BindBody(form); err != nil {
			return e.BadRequestError("An error occurred while loading the submitted data.", err)
		}
		if err := form.Submit(); err != nil {
			if fieldErr, ok := err.(validation.Errors); ok {
				return e.BadRequestError("Failed to send the test email.", fieldErr)
			}
			return e.BadRequestError("Failed to send the test email. Raw error: \n"+err.Error(), nil)
		}
		return e.NoContent(http.StatusNoContent)
	default:
		return e.BadRequestError("unknown settings action: "+actionID, nil)
	}
}
