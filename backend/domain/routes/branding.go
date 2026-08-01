package routes

import (
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/config/sysconfig"
	settingsschema "github.com/websoft9/appos/backend/domain/config/sysconfig/schema"
	"github.com/websoft9/appos/backend/domain/media"
)

func registerBrandingRoutes(se *core.ServeEvent) {
	se.Router.GET("/api/settings/public/branding", handleBrandingGet)
}

// handleBrandingGet returns public branding metadata used by the web shell.
//
// @Summary Get branding metadata
// @Description Returns the current App Name, logo, wordmark, and favicon settings used by the web UI. Public.
// @Tags Branding
// @Success 200 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/settings/public/branding [get]
func handleBrandingGet(e *core.RequestEvent) error {
	basicEntry, ok := settingsschema.FindEntry("basic")
	if !ok {
		return e.InternalServerError("basic settings schema missing", nil)
	}

	basic, err := sysconfig.LoadPocketBaseEntry(e.App, basicEntry)
	if err != nil {
		return e.InternalServerError("failed to load basic branding settings", err)
	}

	branding := settingsschema.DefaultGroup("branding", "identity")
	storedBranding, err := sysconfig.GetGroup(e.App, "branding", "identity", branding)
	if err == nil {
		branding = storedBranding
	}

	appName, _ := basic["appName"].(string)
	appURL, _ := basic["appURL"].(string)
	logoMediaID, _ := branding["logoMediaId"].(string)
	logoURL, _ := branding["logoUrl"].(string)
	loginBackgroundMediaID, _ := branding["loginBackgroundMediaId"].(string)
	loginBackgroundURL, _ := branding["loginBackgroundUrl"].(string)
	wordmark, _ := branding["wordmark"].(string)
	useLogoAsFavicon, _ := branding["useLogoAsFavicon"].(bool)
	faviconMediaID, _ := branding["faviconMediaId"].(string)
	faviconURL, _ := branding["faviconUrl"].(string)

	logoURL = resolveBrandingMediaURL(e.App, logoMediaID, logoURL)
	loginBackgroundURL = resolveBrandingMediaURL(e.App, loginBackgroundMediaID, loginBackgroundURL)
	faviconURL = resolveBrandingMediaURL(e.App, faviconMediaID, faviconURL)

	return e.JSON(http.StatusOK, map[string]any{
		"appName":                appName,
		"appURL":                 appURL,
		"logoMediaId":            logoMediaID,
		"logoUrl":                logoURL,
		"loginBackgroundMediaId": loginBackgroundMediaID,
		"loginBackgroundUrl":     loginBackgroundURL,
		"wordmark":               wordmark,
		"useLogoAsFavicon":       useLogoAsFavicon,
		"faviconMediaId":         faviconMediaID,
		"faviconUrl":             faviconURL,
	})
}

func resolveBrandingMediaURL(app core.App, mediaID, fallback string) string {
	mediaID = strings.TrimSpace(mediaID)
	if mediaID == "" {
		return fallback
	}
	record, err := app.FindRecordById(media.Collection, mediaID)
	if err != nil {
		return fallback
	}
	if publicURL := strings.TrimSpace(record.GetString("public_url")); publicURL != "" {
		return publicURL
	}
	return fallback
}
