package routes

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/ai/copilot"
	"github.com/websoft9/appos/backend/domain/audit"
	sysconfig "github.com/websoft9/appos/backend/domain/config/sysconfig"
	"github.com/websoft9/appos/backend/domain/monitor"
	monitorchecks "github.com/websoft9/appos/backend/domain/monitor/signals/checks"
	monitorstatus "github.com/websoft9/appos/backend/domain/monitor/status"
	"github.com/websoft9/appos/backend/domain/resource/accounts"
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/domain/secrets"
	"github.com/websoft9/appos/backend/infra/egress"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

type aiProviderUpsertRequest struct {
	Name              string         `json:"name"`
	Kind              string         `json:"kind"`
	IsEnabled         *bool          `json:"is_enabled,omitempty"`
	IsDefault         bool           `json:"is_default"`
	TemplateID        string         `json:"template_id"`
	Endpoint          string         `json:"endpoint"`
	AuthScheme        string         `json:"auth_scheme"`
	ProviderAccountID string         `json:"provider_account"`
	CredentialID      string         `json:"credential"`
	EnabledModels     []string       `json:"enabled_models,omitempty"`
	Config            map[string]any `json:"config"`
	Description       string         `json:"description"`
}

type aiProviderResponseDocument struct {
	ID                string         `json:"id"`
	Created           string         `json:"created"`
	Updated           string         `json:"updated"`
	Name              string         `json:"name"`
	Kind              string         `json:"kind"`
	IsEnabled         bool           `json:"is_enabled"`
	IsDefault         bool           `json:"is_default"`
	TemplateID        string         `json:"template_id"`
	Endpoint          string         `json:"endpoint"`
	AuthScheme        string         `json:"auth_scheme"`
	ProviderAccountID string         `json:"provider_account"`
	CredentialID      string         `json:"credential"`
	EnabledModels     []string       `json:"enabled_models,omitempty"`
	Config            map[string]any `json:"config"`
	Description       string         `json:"description"`
}

var _ = aiProviderResponseDocument{}

func registerAIProviderRoutes(se *core.ServeEvent) {
	group := se.Router.Group("/api/ai-providers")
	group.Bind(apis.RequireAuth())
	group.GET("/chat-models", handleAIProviderChatModels)
	group.GET("/defaults", handleAIProviderDefaultsGet)
	group.GET("/templates", handleAIProviderTemplateList)
	group.GET("/templates/{id}", handleAIProviderTemplateGet)
	group.POST("/fetch-models", handleFetchModels)
	group.GET("/reachability", handleAIProviderReachability)
	group.GET("/availability", handleAIProviderAvailability)
	group.GET("/models/{id}", handleAIProviderModels)
	group.GET("", handleAIProviderList)
	group.GET("/{id}", handleAIProviderGet)

	mutations := se.Router.Group("/api/ai-providers")
	mutations.Bind(apis.RequireAuth())
	mutations.Bind(apis.RequireSuperuserAuth())
	mutations.PUT("/defaults", handleAIProviderDefaultsPut)
	mutations.POST("", handleAIProviderCreate)
	mutations.PUT("/{id}", handleAIProviderUpdate)
	mutations.DELETE("/{id}", handleAIProviderDelete)
}

const aiProviderDefaultsModule = "ai"
const aiProviderDefaultsKey = "provider_defaults"

type aiProviderDefaultSelection struct {
	Endpoint   string `json:"endpoint"`
	ProviderID string `json:"provider_id"`
}

type aiProviderDefaultsResponse struct {
	Items []aiProviderDefaultSelection `json:"items"`
}

type aiProviderChatModelItem struct {
	ProviderID   string `json:"provider_id"`
	Endpoint     string `json:"endpoint"`
	ModelID      string `json:"model_id"`
	Label        string `json:"label"`
	ProviderName string `json:"provider_name,omitempty"`
	ProviderMode string `json:"provider_mode,omitempty"`
	GatewayName  string `json:"gateway_name,omitempty"`
	ContextSize  int    `json:"context_size,omitempty"`
	MaxTokens    int    `json:"max_completion_tokens,omitempty"`
}

type aiProviderChatModelsResponse struct {
	Items []aiProviderChatModelItem `json:"items"`
}

type aiProviderModelCandidate struct {
	provider *aiproviders.AIProvider
	template aiproviders.Template
	modelID  string
}

func handleAIProviderTemplateList(e *core.RequestEvent) error {
	templates, err := aiproviders.Templates()
	if err != nil {
		return e.InternalServerError("failed to load AI provider templates", err)
	}
	return e.JSON(http.StatusOK, templates)
}

func handleAIProviderTemplateGet(e *core.RequestEvent) error {
	template, ok, err := aiproviders.FindTemplate(e.Request.PathValue("id"))
	if err != nil {
		return e.InternalServerError("failed to load AI provider template", err)
	}
	if !ok {
		return e.NotFoundError("AI provider template not found", nil)
	}
	return e.JSON(http.StatusOK, template)
}

func handleAIProviderList(e *core.RequestEvent) error {
	items, err := aiproviders.List(persistence.NewAIProviderRepository(e.App))
	if err != nil {
		return e.InternalServerError("failed to list AI providers", err)
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, aiProviderResponse(item))
	}
	return e.JSON(http.StatusOK, result)
}

func handleAIProviderGet(e *core.RequestEvent) error {
	item, err := aiproviders.Get(persistence.NewAIProviderRepository(e.App), e.Request.PathValue("id"))
	if err != nil {
		if isAIProviderNotFound(err) {
			return e.NotFoundError("AI provider not found", err)
		}
		return e.InternalServerError("failed to load AI provider", err)
	}
	return e.JSON(http.StatusOK, aiProviderResponse(item))
}

func handleAIProviderCreate(e *core.RequestEvent) error {
	input, err := bindAIProviderUpsertRequest(e, nil)
	if err != nil {
		return err
	}
	userID, _ := authInfo(e)
	item, saveErr := aiproviders.CreateWithDeps(persistence.NewAIProviderRepository(e.App), input, aiproviders.SaveDeps{
		ActorID:                     userID,
		CredentialRefValidator:      aiProviderCredentialValidator{app: e.App},
		ProviderAccountRefValidator: aiProviderAccountValidator{app: e.App},
	})
	if saveErr != nil {
		writeAIProviderAudit(e, "ai_provider.create", nil, input, nil, saveErr)
		return aiProviderSaveError(e, saveErr)
	}
	writeAIProviderAudit(e, "ai_provider.create", nil, input, item, nil)
	return e.JSON(http.StatusCreated, aiProviderResponse(item))
}

func handleAIProviderUpdate(e *core.RequestEvent) error {
	repo := persistence.NewAIProviderRepository(e.App)
	before, getErr := repo.Get(e.Request.PathValue("id"))
	if getErr != nil {
		if isAIProviderNotFound(getErr) {
			return e.NotFoundError("AI provider not found", getErr)
		}
		return e.InternalServerError("failed to load AI provider", getErr)
	}
	input, err := bindAIProviderUpsertRequest(e, before)
	if err != nil {
		return err
	}
	beforeSnap := before.Snapshot()
	userID, _ := authInfo(e)
	item, saveErr := aiproviders.UpdateExistingWithDeps(repo, before, input, aiproviders.SaveDeps{
		ActorID:                     userID,
		CredentialRefValidator:      aiProviderCredentialValidator{app: e.App},
		ProviderAccountRefValidator: aiProviderAccountValidator{app: e.App},
	})
	if saveErr != nil {
		writeAIProviderAudit(e, "ai_provider.update", &beforeSnap, input, nil, saveErr)
		return aiProviderSaveError(e, saveErr)
	}
	writeAIProviderAudit(e, "ai_provider.update", &beforeSnap, input, item, nil)
	return e.JSON(http.StatusOK, aiProviderResponse(item))
}

func handleAIProviderDelete(e *core.RequestEvent) error {
	repo := persistence.NewAIProviderRepository(e.App)
	before, getErr := repo.Get(e.Request.PathValue("id"))
	if getErr != nil {
		if isAIProviderNotFound(getErr) {
			return e.NotFoundError("AI provider not found", getErr)
		}
		return e.InternalServerError("failed to load AI provider", getErr)
	}
	beforeSnap := before.Snapshot()
	credentialID := strings.TrimSpace(before.CredentialID())
	err := e.App.RunInTransaction(func(txApp core.App) error {
		txRepo := persistence.NewAIProviderRepository(txApp)
		txBefore, err := txRepo.Get(before.ID())
		if err != nil {
			return err
		}
		if err := aiproviders.DeleteExisting(txRepo, txBefore); err != nil {
			return err
		}
		if credentialID == "" {
			return nil
		}
		secretRecord, findErr := txApp.FindRecordById("secrets", credentialID)
		if findErr != nil {
			return nil
		}
		return txApp.Delete(secretRecord)
	})
	if err != nil {
		writeAIProviderAudit(e, "ai_provider.delete", &beforeSnap, aiproviders.SaveInput{}, nil, err)
		return e.InternalServerError("failed to delete AI provider", err)
	}
	writeAIProviderAudit(e, "ai_provider.delete", &beforeSnap, aiproviders.SaveInput{}, nil, nil)
	return e.NoContent(http.StatusNoContent)
}

func bindAIProviderUpsertRequest(e *core.RequestEvent, existing *aiproviders.AIProvider) (aiproviders.SaveInput, error) {
	var body aiProviderUpsertRequest
	if err := e.BindBody(&body); err != nil {
		return aiproviders.SaveInput{}, e.BadRequestError("invalid JSON body", err)
	}
	config := cloneStringAnyMap(body.Config)
	if body.EnabledModels != nil {
		enabledModels := normalizeStringSlice(body.EnabledModels)
		if len(enabledModels) > 0 {
			config["enabled_models"] = enabledModels
		} else {
			delete(config, "enabled_models")
		}
	}
	isEnabled := true
	if existing != nil {
		isEnabled = existing.IsEnabled()
	}
	if body.IsEnabled != nil {
		isEnabled = *body.IsEnabled
	}
	return aiproviders.SaveInput{
		Name:              body.Name,
		Kind:              body.Kind,
		IsEnabled:         isEnabled,
		IsDefault:         body.IsDefault,
		TemplateID:        body.TemplateID,
		Endpoint:          body.Endpoint,
		AuthScheme:        body.AuthScheme,
		ProviderAccountID: body.ProviderAccountID,
		CredentialID:      body.CredentialID,
		Config:            config,
		Description:       body.Description,
	}, nil
}

func aiProviderSaveError(e *core.RequestEvent, err error) error {
	var validationErr *aiproviders.ValidationError
	if errors.As(err, &validationErr) {
		return e.BadRequestError("invalid AI provider payload", err)
	}
	var accessDeniedErr *aiproviders.AccessDeniedError
	if errors.As(err, &accessDeniedErr) {
		return apis.NewForbiddenError(accessDeniedErr.Error(), err)
	}
	var conflictErr *aiproviders.ConflictError
	if errors.As(err, &conflictErr) {
		return apis.NewApiError(http.StatusConflict, conflictErr.Error(), err)
	}
	var notFoundErr *aiproviders.NotFoundError
	if errors.As(err, &notFoundErr) {
		return e.NotFoundError(notFoundErr.Error(), err)
	}
	return e.InternalServerError("failed to save AI provider", err)
}

// ─── Fetch Models ────────────────────────────────────────────────────────────

type fetchModelsRequest struct {
	Endpoint   string `json:"endpoint"`
	APIKey     string `json:"api_key"`
	AuthScheme string `json:"auth_scheme,omitempty"`
	TemplateID string `json:"template_id,omitempty"`
	Protocol   string `json:"protocol,omitempty"`
}

type fetchModelsResponse struct {
	Models []fetchModelsItem  `json:"models"`
	Groups []fetchModelsGroup `json:"groups,omitempty"`
}

type aiProviderReachabilityItem struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	CheckedAt string `json:"checked_at,omitempty"`
	LatencyMS int64  `json:"latency_ms,omitempty"`
	Reason    string `json:"reason,omitempty"`
	Error     string `json:"error,omitempty"`
}

type aiProviderReachabilityResponse struct {
	Items []aiProviderReachabilityItem `json:"items"`
}

type aiProviderAvailabilityItem struct {
	ID        string `json:"id"`
	Status    string `json:"status"`
	CheckedAt string `json:"checked_at,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

type aiProviderAvailabilityResponse struct {
	Items []aiProviderAvailabilityItem `json:"items"`
}

var defaultAIProviderStatusPriority = map[string]int{
	monitor.StatusHealthy:           0,
	monitor.StatusDegraded:          1,
	monitor.StatusUnreachable:       2,
	monitor.StatusCredentialInvalid: 3,
	monitor.StatusUnknown:           4,
}

func aiProviderReachabilityMonitorStatus(apiStatus string) string {
	switch strings.ToLower(strings.TrimSpace(apiStatus)) {
	case "reachable":
		return monitor.StatusHealthy
	case "unreachable":
		return monitor.StatusUnreachable
	default:
		return monitor.StatusUnknown
	}
}

func aiProviderAvailabilityMonitorStatus(apiStatus string) string {
	switch strings.ToLower(strings.TrimSpace(apiStatus)) {
	case "available":
		return monitor.StatusHealthy
	case "unavailable":
		return monitor.StatusDegraded
	default:
		return monitor.StatusUnknown
	}
}

func projectAIProviderStatus(app core.App, targetID, displayName, checkKind, monitorStatus, reason string, summary map[string]any, now time.Time) {
	_ = monitorstatus.ProjectResourceCheckLatestStatus(
		app,
		monitor.TargetTypeAIProvider,
		targetID,
		displayName,
		monitor.SignalSourceAppOS,
		checkKind,
		monitorStatus,
		reason,
		summary,
		defaultAIProviderStatusPriority,
		now,
	)
}

var newAIProviderHTTPClientPlan = egress.NewHTTPClientPlan

type fetchModelsItem struct {
	ID               string `json:"id"`
	Vendor           string `json:"vendor,omitempty"`
	EnabledByDefault bool   `json:"enabled_by_default,omitempty"`
}

type fetchModelsGroup struct {
	Vendor string            `json:"vendor"`
	Models []fetchModelsItem `json:"models"`
}

func handleFetchModels(e *core.RequestEvent) error {
	var body fetchModelsRequest
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}

	endpoint := strings.TrimSpace(body.Endpoint)
	apiKey := strings.TrimSpace(body.APIKey)
	authScheme := strings.TrimSpace(body.AuthScheme)
	if endpoint == "" {
		return e.BadRequestError("endpoint is required", nil)
	}
	result, err := fetchProviderModels(e.App, e.Request.Context(), endpoint, apiKey, authScheme, body.TemplateID, body.Protocol)
	if err != nil {
		return e.BadRequestError(describeFetchModelsError(err), err)
	}
	return e.JSON(http.StatusOK, result)
}

// handleAIProviderModels fetches available models from a stored AI provider.
func handleAIProviderModels(e *core.RequestEvent) error {
	providerID := e.Request.PathValue("id")
	repo := persistence.NewAIProviderRepository(e.App)
	item, err := repo.Get(providerID)
	if err != nil {
		return e.NotFoundError("AI provider not found", err)
	}
	checkedAt := time.Now().UTC().Format(time.RFC3339)
	apiKey, resolveErr := resolveAIProviderAPIKey(e, item)
	if resolveErr != nil {
		persistAIProviderProbeResult(e.App, item, "availability", "unavailable", resolveErr.Error(), checkedAt, nil)
		return e.InternalServerError("failed to resolve provider credential", resolveErr)
	}
	endpoint, protocol, protocolErr := aiproviders.ResolveActiveEndpointAndProtocol(item)
	if protocolErr != nil {
		persistAIProviderProbeResult(e.App, item, "availability", "unavailable", protocolErr.Error(), checkedAt, nil)
		return e.InternalServerError("failed to resolve AI provider protocol", protocolErr)
	}
	result, fetchErr := fetchProviderModels(e.App, e.Request.Context(), endpoint, apiKey, strings.TrimSpace(item.AuthScheme()), strings.TrimSpace(item.TemplateID()), protocol)
	if fetchErr != nil {
		persistAIProviderProbeResult(e.App, item, "availability", "unavailable", fetchErr.Error(), checkedAt, nil)
		return e.BadRequestError(describeFetchModelsError(fetchErr), fetchErr)
	}
	persistAIProviderProbeResult(e.App, item, "availability", "available", "", checkedAt, nil)
	return e.JSON(http.StatusOK, result)
}

func describeFetchModelsError(err error) string {
	if err == nil {
		return "Could not load models. Verify the API endpoint, secret, and network connectivity, then try again."
	}
	message := strings.TrimSpace(err.Error())
	lower := strings.ToLower(message)
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return "Loading models timed out. Check network connectivity and confirm the provider endpoint is reachable."
	}
	if strings.Contains(lower, "401") || strings.Contains(lower, "403") || strings.Contains(lower, "unauthorized") || strings.Contains(lower, "forbidden") {
		return "Authentication failed while loading models. Check the API key or secret and try again."
	}
	if strings.Contains(lower, "404") {
		return "The model list endpoint was not found. Check the API endpoint and make sure this provider exposes a compatible models API."
	}
	if strings.Contains(lower, "x509") || strings.Contains(lower, "tls") || strings.Contains(lower, "certificate") {
		return "TLS verification failed while loading models. Check the provider certificate or endpoint URL."
	}
	if strings.Contains(lower, "no such host") || strings.Contains(lower, "dial tcp") || strings.Contains(lower, "connection refused") {
		return "Could not reach the provider endpoint. Check the API endpoint, DNS, proxy, or firewall settings."
	}
	if message != "" {
		return message
	}
	return "Could not load models. Verify the API endpoint, secret, and network connectivity, then try again."
}

func handleAIProviderReachability(e *core.RequestEvent) error {
	items, err := listAIProviderTargets(e)
	if err != nil {
		return e.InternalServerError("failed to list AI providers", err)
	}

	results := make([]aiProviderReachabilityItem, len(items))
	var waitGroup sync.WaitGroup
	now := time.Now().UTC()
	timeout := monitorchecks.LoadReachabilityProbeTimeout(e.App)
	for index, item := range items {
		waitGroup.Add(1)
		go func(index int, item *aiproviders.AIProvider, timeout time.Duration) {
			defer waitGroup.Done()
			results[index] = probeAIProviderReachabilityWithTimeout(item, timeout)
		}(index, item, timeout)
	}
	waitGroup.Wait()

	for _, result := range results {
		if result.ID == "" {
			continue
		}
		projectAIProviderStatus(e.App, result.ID, result.ID, monitor.CheckKindReachability,
			aiProviderReachabilityMonitorStatus(result.Status), result.Reason,
			map[string]any{"check_kind": monitor.CheckKindReachability, "latency_ms": result.LatencyMS},
			now)
	}

	return e.JSON(http.StatusOK, aiProviderReachabilityResponse{Items: results})
}

// handleAIProviderAvailability probes whether AppOS can actually use one or more AI providers.
//
// @Summary Check AI provider availability
// @Description Resolves provider credentials and fetches models to determine whether one or more AI providers are currently usable to AppOS.
// @Tags Resource
// @Security BearerAuth
// @Param ids query string false "comma-separated AI provider ids"
// @Success 200 {object} aiProviderAvailabilityResponse
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/ai-providers/availability [get]
func handleAIProviderAvailability(e *core.RequestEvent) error {
	items, err := listAIProviderTargets(e)
	if err != nil {
		return e.InternalServerError("failed to list AI providers", err)
	}

	results := make([]aiProviderAvailabilityItem, len(items))
	var waitGroup sync.WaitGroup
	now := time.Now().UTC()
	for index, item := range items {
		waitGroup.Add(1)
		go func(index int, item *aiproviders.AIProvider) {
			defer waitGroup.Done()
			results[index] = probeAIProviderAvailability(e, item)
		}(index, item)
	}
	waitGroup.Wait()

	for _, result := range results {
		if result.ID == "" {
			continue
		}
		if item := findAIProviderByID(items, result.ID); item != nil {
			persistAIProviderProbeResult(e.App, item, "availability", result.Status, result.Reason, result.CheckedAt, nil)
		}
		projectAIProviderStatus(e.App, result.ID, result.ID, monitor.CheckKindAvailability,
			aiProviderAvailabilityMonitorStatus(result.Status), result.Reason,
			map[string]any{"check_kind": monitor.CheckKindAvailability},
			now)
	}

	return e.JSON(http.StatusOK, aiProviderAvailabilityResponse{Items: results})
}

func listAIProviderTargets(e *core.RequestEvent) ([]*aiproviders.AIProvider, error) {
	repo := persistence.NewAIProviderRepository(e.App)
	idsParam := strings.TrimSpace(e.Request.URL.Query().Get("ids"))
	var (
		items []*aiproviders.AIProvider
		err   error
	)
	if idsParam == "" {
		items, err = aiproviders.List(repo)
	} else {
		for _, id := range strings.Split(idsParam, ",") {
			trimmed := strings.TrimSpace(id)
			if trimmed == "" {
				continue
			}
			item, getErr := aiproviders.Get(repo, trimmed)
			if getErr != nil {
				continue
			}
			items = append(items, item)
		}
	}
	return items, err
}

func findAIProviderByID(items []*aiproviders.AIProvider, id string) *aiproviders.AIProvider {
	trimmedID := strings.TrimSpace(id)
	if trimmedID == "" {
		return nil
	}
	for _, item := range items {
		if item != nil && strings.TrimSpace(item.ID()) == trimmedID {
			return item
		}
	}
	return nil
}

func persistAIProviderProbeResult(app core.App, item *aiproviders.AIProvider, key string, status string, reason string, checkedAt string, extra map[string]any) {
	if app == nil || item == nil || strings.TrimSpace(item.ID()) == "" {
		return
	}
	snapshot := item.Snapshot()
	config := snapshot.Config
	if config == nil {
		config = map[string]any{}
	}
	probeState := map[string]any{
		"status": strings.TrimSpace(status),
	}
	if trimmedReason := strings.TrimSpace(reason); trimmedReason != "" {
		probeState["reason"] = trimmedReason
	}
	if trimmedCheckedAt := strings.TrimSpace(checkedAt); trimmedCheckedAt != "" {
		probeState["checked_at"] = trimmedCheckedAt
	}
	for extraKey, extraValue := range extra {
		if strings.TrimSpace(extraKey) == "" || extraValue == nil {
			continue
		}
		probeState[extraKey] = extraValue
	}
	config[strings.TrimSpace(key)] = probeState
	item.ApplySaveInput(aiproviders.SaveInput{
		Name:              snapshot.Name,
		Kind:              snapshot.Kind,
		IsEnabled:         snapshot.IsEnabled,
		IsDefault:         snapshot.IsDefault,
		TemplateID:        snapshot.TemplateID,
		Endpoint:          snapshot.Endpoint,
		AuthScheme:        snapshot.AuthScheme,
		ProviderAccountID: snapshot.ProviderAccountID,
		CredentialID:      snapshot.CredentialID,
		Config:            config,
		Description:       snapshot.Description,
	})
	_ = persistence.NewAIProviderRepository(app).Save(item)
}

func probeAIProviderReachability(item *aiproviders.AIProvider) aiProviderReachabilityItem {
	return probeAIProviderReachabilityWithTimeout(item, monitorchecks.LoadReachabilityProbeTimeout(nil))
}

func probeAIProviderReachabilityWithTimeout(item *aiproviders.AIProvider, timeout time.Duration) aiProviderReachabilityItem {
	status := aiProviderReachabilityItem{
		ID:        item.ID(),
		Status:    "unknown",
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
	}
	host, port, err := aiProviderProbeTarget(item)
	if err != nil {
		status.Reason = err.Error()
		status.Error = err.Error()
		return status
	}
	start := time.Now()
	conn, dialErr := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), timeout)
	if dialErr != nil {
		status.Status = "unreachable"
		status.Reason = dialErr.Error()
		status.Error = dialErr.Error()
		return status
	}
	_ = conn.Close()
	status.Status = "reachable"
	status.LatencyMS = time.Since(start).Milliseconds()
	return status
}

func probeAIProviderAvailability(e *core.RequestEvent, item *aiproviders.AIProvider) aiProviderAvailabilityItem {
	status := aiProviderAvailabilityItem{
		ID:        item.ID(),
		Status:    "unknown",
		CheckedAt: time.Now().UTC().Format(time.RFC3339),
	}
	apiKey, resolveErr := resolveAIProviderAPIKey(e, item)
	if resolveErr != nil {
		status.Status = "unavailable"
		status.Reason = resolveErr.Error()
		return status
	}
	if validateErr := validateAIProviderCredential(e.App, e.Request.Context(), item, apiKey); validateErr != nil {
		status.Status = "unavailable"
		status.Reason = validateErr.Error()
		return status
	}
	endpoint, protocol, protocolErr := aiproviders.ResolveActiveEndpointAndProtocol(item)
	if protocolErr != nil {
		status.Status = "unavailable"
		status.Reason = protocolErr.Error()
		return status
	}
	if reachErr := checkProviderReachability(e.App, e.Request.Context(), endpoint, apiKey, strings.TrimSpace(item.AuthScheme()), strings.TrimSpace(item.TemplateID()), protocol); reachErr != nil {
		status.Status = "unavailable"
		status.Reason = reachErr.Error()
		return status
	}
	status.Status = "available"
	return status
}

func aiProviderProbeTarget(item *aiproviders.AIProvider) (string, int, error) {
	if item == nil {
		return "", 0, errors.New("provider is nil")
	}
	endpoint, _, err := aiproviders.ResolveActiveEndpointAndProtocol(item)
	if err != nil {
		return "", 0, err
	}
	raw := strings.TrimSpace(endpoint)
	if raw == "" {
		return "", 0, errors.New("endpoint is empty")
	}
	parsedRaw := raw
	if !strings.Contains(parsedRaw, "://") {
		parsedRaw = "https://" + parsedRaw
	}
	parsed, err := url.Parse(parsedRaw)
	if err != nil {
		return "", 0, err
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return "", 0, errors.New("endpoint host is empty")
	}
	if rawPort := strings.TrimSpace(parsed.Port()); rawPort != "" {
		port, convErr := strconv.Atoi(rawPort)
		if convErr != nil {
			return host, 0, convErr
		}
		return host, port, nil
	}
	switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
	case "http":
		return host, 80, nil
	case "https", "":
		return host, 443, nil
	default:
		return host, 0, errors.New("endpoint port is required")
	}
}

func validateAIProviderCredential(app core.App, ctx context.Context, item *aiproviders.AIProvider, apiKey string) error {
	if item == nil {
		return nil
	}
	if apiKey == "" {
		return nil
	}
	if copilot.IsOpenRouterEndpoint(item.Endpoint()) {
		client := newAIProviderHTTPClient(app, false)
		return copilot.ValidateOpenRouterCredential(ctx, &client, item.Endpoint(), map[string]string{
			"HTTP-Referer": "https://appos.local",
			"X-Title":      "AppOS",
		}, apiKey)
	}
	return nil
}

func handleAIProviderDefaultsGet(e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, aiProviderDefaultsResponse{Items: listAIProviderDefaults(e.App)})
}

func handleAIProviderDefaultsPut(e *core.RequestEvent) error {
	var body aiProviderDefaultsResponse
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("invalid JSON body", err)
	}
	if err := saveAIProviderDefaults(e.App, body.Items); err != nil {
		return e.InternalServerError("failed to save AI provider defaults", err)
	}
	return e.JSON(http.StatusOK, aiProviderDefaultsResponse{Items: listAIProviderDefaults(e.App)})
}

func handleAIProviderChatModels(e *core.RequestEvent) error {
	repo := persistence.NewAIProviderRepository(e.App)
	items, err := aiproviders.List(repo)
	if err != nil {
		return e.InternalServerError("failed to list AI providers", err)
	}
	e.App.Logger().Info("chat-models: total providers", "count", len(items))
	filtered := make([]*aiproviders.AIProvider, 0, len(items))
	for _, item := range items {
		kind := strings.TrimSpace(item.Kind())
		enabled := item.IsEnabled()
		e.App.Logger().Info("chat-models: provider", "id", item.ID(), "kind", kind, "is_enabled", enabled)
		if kind == aiproviders.KindLLM && enabled {
			filtered = append(filtered, item)
		}
	}
	e.App.Logger().Info("chat-models: after kind+enabled filter", "count", len(filtered))
	for _, item := range filtered {
		enabledModels := configStringSlice(item.Config(), "enabled_models")
		fallback := firstConfigString(item.Config(), "defaultModel", "model")
		e.App.Logger().Info("chat-models: provider model config", "id", item.ID(), "enabled_models", enabledModels, "defaultModel", fallback)
	}
	defaults := defaultProviderMap(e.App)
	chatModels, buildErr := buildAIProviderChatModels(filtered, defaults)
	if buildErr != nil {
		return e.InternalServerError("failed to build AI provider chat models", buildErr)
	}
	e.App.Logger().Info("chat-models: final result", "count", len(chatModels))
	return e.JSON(http.StatusOK, aiProviderChatModelsResponse{Items: chatModels})
}

func buildProviderProbeRequest(app core.App, ctx context.Context, endpoint string, apiKey string, authScheme string, templateID string, protocol string) (http.Client, *http.Request, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return http.Client{}, nil, errors.New("endpoint is required")
	}

	modelsURL := strings.TrimRight(endpoint, "/") + "/models"
	useBearerAuth := false
	useQueryAPIKey := false
	useAnthropicHeaders := false
	var tpl aiproviders.Template
	var hasTemplate bool
	if templateID != "" {
		var findErr error
		tpl, hasTemplate, findErr = aiproviders.FindTemplate(templateID)
		if findErr != nil {
			return http.Client{}, nil, findErr
		}
		if protocolTpl, ok := findTemplateProtocol(tpl, protocol); ok && strings.TrimSpace(protocolTpl.ModelsEndpoint) != "" {
			modelsURL = resolveModelsEndpoint(endpoint, protocolTpl.ModelsEndpoint)
		} else if hasTemplate && tpl.ModelsEndpoint != "" {
			modelsURL = resolveModelsEndpoint(endpoint, tpl.ModelsEndpoint)
		}
	}
	normalizedProtocol := aiproviders.NormalizeProtocol(protocol)
	if normalizedProtocol == aiproviders.ProtocolAnthropic {
		useAnthropicHeaders = true
		modelsURL = strings.TrimRight(endpoint, "/") + "/models"
	} else if normalizedProtocol == aiproviders.ProtocolOllama {
		modelsURL = resolveModelsEndpoint(endpoint, "/api/tags")
	} else if isGoogleGeminiProvider(templateID, endpoint) {
		modelsURL = resolveGoogleGeminiModelsURL(endpoint)
		useBearerAuth = isGoogleGeminiOpenAIEndpoint(endpoint)
		useQueryAPIKey = !useBearerAuth
	} else if isAWSBedrockProvider(templateID, endpoint) {
		var resolveErr error
		modelsURL, resolveErr = resolveAWSBedrockModelsURL(endpoint)
		if resolveErr != nil {
			return http.Client{}, nil, resolveErr
		}
		useBearerAuth = true
	} else if apiKey != "" {
		useBearerAuth = strings.EqualFold(strings.TrimSpace(authScheme), "bearer") || strings.TrimSpace(authScheme) == ""
	}

	client := newAIProviderHTTPClient(app, hasTemplate && tpl.SkipTLSCertVerify)
	req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL, nil)
	if reqErr != nil {
		return http.Client{}, nil, reqErr
	}
	req.Header.Set("Accept", "application/json")
	if useQueryAPIKey {
		if apiKey != "" {
			query := req.URL.Query()
			query.Set("key", apiKey)
			req.URL.RawQuery = query.Encode()
		}
	} else if useAnthropicHeaders {
		applyAuthSchemeHeaders(req, apiKey, authScheme)
		req.Header.Set("anthropic-version", resolveAnthropicVersion(tpl))
	} else if useBearerAuth || apiKey != "" {
		applyAuthSchemeHeaders(req, apiKey, authScheme)
	}
	return client, req, nil
}

func checkProviderReachability(app core.App, ctx context.Context, endpoint string, apiKey string, authScheme string, templateID string, protocol string) error {
	client, req, err := buildProviderProbeRequest(app, ctx, endpoint, apiKey, authScheme, templateID, protocol)
	if err != nil {
		return err
	}
	resp, doErr := client.Do(req)
	if doErr != nil {
		return doErr
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return errors.New("provider returned non-200: " + http.StatusText(resp.StatusCode) + ": " + string(bodyBytes))
	}
	return nil
}

func fetchProviderModels(app core.App, ctx context.Context, endpoint string, apiKey string, authScheme string, templateID string, protocol string) (fetchModelsResponse, error) {
	client, req, err := buildProviderProbeRequest(app, ctx, endpoint, apiKey, authScheme, templateID, protocol)
	if err != nil {
		return fetchModelsResponse{}, err
	}

	resp, doErr := client.Do(req)
	if doErr != nil {
		return fetchModelsResponse{}, doErr
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fetchModelsResponse{}, errors.New("provider returned non-200: " + http.StatusText(resp.StatusCode) + ": " + string(bodyBytes))
	}

	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return fetchModelsResponse{}, readErr
	}

	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return fetchModelsResponse{}, err
	}
	defaultEnabled := map[string]struct{}{}
	var tpl aiproviders.Template
	var hasTemplate bool
	if templateID != "" {
		tpl, hasTemplate, _ = aiproviders.FindTemplate(templateID)
	}
	if hasTemplate {
		for _, model := range tpl.DefaultEnabledModels {
			trimmed := strings.TrimSpace(model)
			if trimmed != "" {
				defaultEnabled[trimmed] = struct{}{}
			}
		}
	}
	return buildFetchModelsResponse(parsed, defaultEnabled, templateID), nil
}

func newAIProviderHTTPClient(app core.App, skipTLSVerify bool) http.Client {
	plan, err := newAIProviderHTTPClientPlan(app, "http.ai", 8*time.Second, skipTLSVerify)
	if err != nil {
		if app != nil {
			app.Logger().Warn("ai provider proxy resolution failed", "consumer", "http.ai", "error", err)
		}
		return egress.NewDirectHTTPClient(8*time.Second, skipTLSVerify)
	}
	for _, warning := range plan.Decision.Warnings {
		if strings.TrimSpace(warning.Message) == "" {
			continue
		}
		app.Logger().Warn("ai provider proxy warning", "consumer", "http.ai", "code", string(warning.Code), "message", warning.Message)
	}
	return plan.Client
}

func buildFetchModelsResponse(parsed any, defaultEnabled map[string]struct{}, templateID string) fetchModelsResponse {
	models := collectModelItems(parsed, defaultEnabled, templateID)
	groups := make([]fetchModelsGroup, 0)
	if len(models) > 0 {
		grouped := map[string][]fetchModelsItem{}
		order := make([]string, 0)
		for _, model := range models {
			vendor := strings.TrimSpace(model.Vendor)
			if vendor == "" {
				vendor = "Other"
			}
			if _, ok := grouped[vendor]; !ok {
				order = append(order, vendor)
			}
			grouped[vendor] = append(grouped[vendor], model)
		}
		for _, vendor := range order {
			groups = append(groups, fetchModelsGroup{Vendor: vendor, Models: grouped[vendor]})
		}
	}
	return fetchModelsResponse{Models: models, Groups: groups}
}

func findTemplateProtocol(template aiproviders.Template, protocol string) (aiproviders.TemplateProtocol, bool) {
	normalized := aiproviders.NormalizeProtocol(protocol)
	for _, item := range aiproviders.TemplateProtocols(template) {
		if aiproviders.NormalizeProtocol(item.ID) == normalized {
			return item, true
		}
	}
	return aiproviders.TemplateProtocol{}, false
}

func resolveAnthropicVersion(template aiproviders.Template) string {
	for _, field := range template.Fields {
		if strings.TrimSpace(field.ID) != "version" {
			continue
		}
		if value := strings.TrimSpace(fmt.Sprint(field.Default)); value != "" && value != "<nil>" {
			return value
		}
	}
	return "2023-06-01"
}

func applyAuthSchemeHeaders(req *http.Request, apiKey string, authScheme string) {
	if req == nil {
		return
	}
	req.Header.Del("Authorization")
	req.Header.Del("x-api-key")
	apiKey = strings.TrimSpace(apiKey)
	switch strings.TrimSpace(strings.ToLower(authScheme)) {
	case "", "bearer":
		if apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+apiKey)
		}
	case "api_key":
		if apiKey != "" {
			req.Header.Set("x-api-key", apiKey)
		}
	case "basic":
		if apiKey != "" {
			req.Header.Set("Authorization", "Basic "+apiKey)
		}
	case "none":
		return
	default:
		if apiKey != "" {
			req.Header.Set("Authorization", "Bearer "+apiKey)
		}
	}
}

func collectModelItems(parsed any, defaultEnabled map[string]struct{}, templateID string) []fetchModelsItem {
	items := make([]fetchModelsItem, 0)
	seen := map[string]struct{}{}
	appendItem := func(id string, vendor string, source map[string]any) {
		trimmedID := normalizeFetchedModelID(id)
		if trimmedID == "" {
			return
		}
		if isGoogleGeminiProvider(templateID, "") && !supportsGenerativeModel(source) {
			return
		}
		if isAWSBedrockProvider(templateID, "") && !supportsTextOutputModel(source) {
			return
		}
		if _, ok := seen[trimmedID]; ok {
			return
		}
		seen[trimmedID] = struct{}{}
		_, enabledByDefault := defaultEnabled[trimmedID]
		items = append(items, fetchModelsItem{ID: trimmedID, Vendor: strings.TrimSpace(vendor), EnabledByDefault: enabledByDefault})
	}

	var visit func(any)
	visit = func(node any) {
		switch typed := node.(type) {
		case map[string]any:
			if id := firstMapString(typed, "id", "name", "model", "modelId", "modelName"); id != "" {
				appendItem(id, inferModelVendor(id, typed), typed)
			}
			for _, key := range []string{"data", "models", "items", "results", "modelSummaries"} {
				if next, ok := typed[key]; ok {
					visit(next)
				}
			}
		case []any:
			for _, item := range typed {
				visit(item)
			}
		}
	}
	visit(parsed)
	return items
}

func normalizeFetchedModelID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimPrefix(trimmed, "models/")
	return strings.TrimSpace(trimmed)
}

func supportsGenerativeModel(source map[string]any) bool {
	raw, ok := source["supportedGenerationMethods"]
	if !ok {
		return true
	}
	methods, ok := raw.([]any)
	if !ok {
		return true
	}
	for _, method := range methods {
		name := strings.TrimSpace(fmt.Sprint(method))
		if name == "generateContent" || name == "streamGenerateContent" {
			return true
		}
	}
	return false
}

func supportsTextOutputModel(source map[string]any) bool {
	raw, ok := source["outputModalities"]
	if !ok {
		return true
	}
	modalities, ok := raw.([]any)
	if !ok {
		return true
	}
	for _, modality := range modalities {
		name := strings.TrimSpace(strings.ToUpper(fmt.Sprint(modality)))
		if name == "TEXT" {
			return true
		}
	}
	return false
}

func isGoogleGeminiProvider(templateID string, endpoint string) bool {
	if strings.EqualFold(strings.TrimSpace(templateID), "google-gemini") {
		return true
	}
	return strings.Contains(strings.ToLower(strings.TrimSpace(endpoint)), "generativelanguage.googleapis.com")
}

func isGoogleGeminiOpenAIEndpoint(endpoint string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(endpoint)), "/openai")
}

func resolveGoogleGeminiModelsURL(endpoint string) string {
	base := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if isGoogleGeminiOpenAIEndpoint(base) {
		return base + "/models"
	}
	return resolveModelsEndpoint(base, "/models")
}

func isAWSBedrockProvider(templateID string, endpoint string) bool {
	if strings.EqualFold(strings.TrimSpace(templateID), "aws-bedrock") {
		return true
	}
	host := extractEndpointHostname(endpoint)
	return strings.HasPrefix(host, "bedrock-runtime.") || strings.HasPrefix(host, "bedrock-mantle.") || strings.HasPrefix(host, "bedrock.")
}

func resolveAWSBedrockModelsURL(endpoint string) (string, error) {
	host := extractEndpointHostname(endpoint)
	if strings.HasPrefix(host, "bedrock-mantle.") {
		return strings.TrimRight(endpoint, "/") + "/models", nil
	}
	region := extractAWSBedrockRegion(endpoint)
	if region == "" {
		return "", errors.New("could not determine AWS Bedrock region from endpoint")
	}
	return "https://bedrock." + region + ".amazonaws.com/foundation-models", nil
}

func extractEndpointHostname(rawEndpoint string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawEndpoint))
	if err == nil && parsed.Hostname() != "" {
		return strings.ToLower(parsed.Hostname())
	}
	return strings.ToLower(strings.TrimSpace(rawEndpoint))
}

func extractAWSBedrockRegion(endpoint string) string {
	host := extractEndpointHostname(endpoint)
	for _, prefix := range []string{"bedrock-mantle.", "bedrock-runtime.", "bedrock."} {
		if strings.HasPrefix(host, prefix) {
			remainder := strings.TrimPrefix(host, prefix)
			parts := strings.Split(remainder, ".")
			if len(parts) > 0 {
				return strings.TrimSpace(parts[0])
			}
		}
	}
	return ""
}

func inferModelVendor(id string, source map[string]any) string {
	if vendor := firstMapString(source, "vendor", "provider", "providerName", "owned_by", "family"); vendor != "" {
		return humanizeVendor(vendor)
	}
	trimmedID := normalizeFetchedModelID(id)
	if strings.Contains(trimmedID, "/") {
		return humanizeVendor(strings.SplitN(trimmedID, "/", 2)[0])
	}
	return ""
}

func firstMapString(source map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := source[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func humanizeVendor(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parts := strings.FieldsFunc(strings.ReplaceAll(raw, "_", "-"), func(r rune) bool { return r == '-' || r == '/' || r == ':' || r == '.' })
	for index, part := range parts {
		if part == "" {
			continue
		}
		parts[index] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
	}
	return strings.Join(parts, " ")
}

func normalizeStringSlice(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func cloneStringAnyMap(input map[string]any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func resolveAIProviderAPIKey(e *core.RequestEvent, item *aiproviders.AIProvider) (string, error) {
	credentialID := strings.TrimSpace(item.CredentialID())
	if credentialID == "" {
		return "", nil
	}
	userID, _ := authInfo(e)
	resolved, resolveErr := secrets.Resolve(e.App, credentialID, userID)
	if resolveErr != nil {
		return "", resolveErr
	}
	return secrets.FirstStringFromPayload(resolved.Payload, "apiKey", "api_key", "token", "value"), nil
}

// resolveModelsEndpoint builds an absolute models URL.
// If modelsEndpoint starts with "http", it is used as-is.
// Otherwise it is treated as a path relative to the provider endpoint (with /v1 stripped).
func resolveModelsEndpoint(providerEndpoint, modelsEndpoint string) string {
	if strings.HasPrefix(modelsEndpoint, "http") {
		return modelsEndpoint
	}
	base := strings.TrimRight(providerEndpoint, "/")
	if strings.HasSuffix(base, "/v1") {
		base = strings.TrimRight(base, "/v1")
	}
	return strings.TrimRight(base, "/") + "/" + strings.TrimLeft(modelsEndpoint, "/")
}

func aiProviderResponse(item *aiproviders.AIProvider) map[string]any {
	return map[string]any{
		"id":               item.ID(),
		"created":          item.Created(),
		"updated":          item.Updated(),
		"name":             item.Name(),
		"kind":             item.Kind(),
		"is_enabled":       item.IsEnabled(),
		"is_default":       item.IsDefault(),
		"template_id":      item.TemplateID(),
		"endpoint":         item.Endpoint(),
		"auth_scheme":      item.AuthScheme(),
		"provider_account": item.ProviderAccountID(),
		"credential":       item.CredentialID(),
		"enabled_models":   normalizeStringSlice(configStringSlice(item.Config(), "enabled_models")),
		"config":           item.Config(),
		"description":      item.Description(),
	}
}

func listAIProviderDefaults(app core.App) []aiProviderDefaultSelection {
	byEndpoint := defaultProviderMap(app)
	endpoints := make([]string, 0, len(byEndpoint))
	for endpoint := range byEndpoint {
		endpoints = append(endpoints, endpoint)
	}
	sort.Strings(endpoints)
	result := make([]aiProviderDefaultSelection, 0, len(endpoints))
	for _, endpoint := range endpoints {
		result = append(result, aiProviderDefaultSelection{Endpoint: endpoint, ProviderID: byEndpoint[endpoint]})
	}
	return result
}

func saveAIProviderDefaults(app core.App, items []aiProviderDefaultSelection) error {
	byEndpoint := map[string]any{}
	for _, item := range items {
		endpoint := strings.TrimSpace(item.Endpoint)
		providerID := strings.TrimSpace(item.ProviderID)
		if endpoint == "" || providerID == "" {
			continue
		}
		byEndpoint[endpoint] = providerID
	}
	return sysconfig.SetGroup(app, aiProviderDefaultsModule, aiProviderDefaultsKey, map[string]any{"by_endpoint": byEndpoint})
}

func defaultProviderMap(app core.App) map[string]string {
	group, _ := sysconfig.GetGroup(app, aiProviderDefaultsModule, aiProviderDefaultsKey, map[string]any{"by_endpoint": map[string]any{}})
	raw, _ := group["by_endpoint"].(map[string]any)
	result := map[string]string{}
	for endpoint, value := range raw {
		providerID := strings.TrimSpace(fmt.Sprint(value))
		if endpoint != "" && providerID != "" {
			result[strings.TrimSpace(endpoint)] = providerID
		}
	}
	return result
}

func buildAIProviderChatModels(items []*aiproviders.AIProvider, defaults map[string]string) ([]aiProviderChatModelItem, error) {
	byKey := map[string][]aiProviderModelCandidate{}
	for _, item := range items {
		endpoint, _, err := aiproviders.ResolveActiveEndpointAndProtocol(item)
		if err != nil {
			return nil, err
		}
		endpoint = strings.TrimSpace(endpoint)
		if endpoint == "" {
			continue
		}
		modelIDs := normalizeStringSlice(configStringSlice(item.Config(), "enabled_models"))
		if len(modelIDs) == 0 {
			fallback := firstConfigString(item.Config(), "defaultModel", "model")
			if fallback != "" {
				modelIDs = []string{fallback}
			}
		}
		if len(modelIDs) == 0 {
			continue
		}
		template, _, err := aiproviders.FindTemplate(item.TemplateID())
		if err != nil {
			return nil, err
		}
		for _, modelID := range modelIDs {
			key := endpoint + "\n" + modelID
			byKey[key] = append(byKey[key], aiProviderModelCandidate{provider: item, template: template, modelID: modelID})
		}
	}

	keys := make([]string, 0, len(byKey))
	for key := range byKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	result := make([]aiProviderChatModelItem, 0, len(keys))
	for _, key := range keys {
		candidates := byKey[key]
		if len(candidates) == 0 {
			continue
		}
		preferred := preferredProviderForEndpoint(candidates, defaults)
		endpoint := strings.TrimSpace(preferred.provider.Endpoint())
		providerMode := strings.TrimSpace(preferred.template.ProviderMode)
		gatewayName := strings.TrimSpace(preferred.template.Title)
		maxTokens := firstConfigInt(preferred.provider.Config(), "max_completion_tokens", "maxCompletionTokens")
		if maxTokens == nil {
			maxTokens = templateFieldDefaultInt(preferred.template, "max_completion_tokens")
		}
		label := preferred.modelID
		if providerMode == "gateway" && gatewayName != "" {
			label = preferred.modelID + " · " + gatewayName
		}
		contextSize := preferred.template.ContextSize
		resolvedMaxTokens := 0
		if maxTokens != nil && *maxTokens > 0 {
			resolvedMaxTokens = *maxTokens
		}
		result = append(result, aiProviderChatModelItem{
			ProviderID:   preferred.provider.ID(),
			Endpoint:     endpoint,
			ModelID:      preferred.modelID,
			Label:        label,
			ProviderName: preferred.provider.Name(),
			ProviderMode: providerMode,
			GatewayName:  gatewayName,
			ContextSize:  contextSize,
			MaxTokens:    resolvedMaxTokens,
		})
	}
	return result, nil
}

func firstConfigInt(config map[string]any, keys ...string) *int {
	for _, key := range keys {
		value, ok := config[key]
		if !ok || value == nil {
			continue
		}
		switch typed := value.(type) {
		case int:
			if typed > 0 {
				result := typed
				return &result
			}
		case int32:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case int64:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case float64:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case string:
			text := strings.TrimSpace(typed)
			if text == "" {
				continue
			}
			parsed, err := strconv.Atoi(text)
			if err == nil && parsed > 0 {
				return &parsed
			}
		}
	}
	return nil
}

func templateFieldDefaultInt(template aiproviders.Template, fieldID string) *int {
	fieldID = strings.TrimSpace(fieldID)
	if fieldID == "" {
		return nil
	}
	for _, field := range template.Fields {
		if strings.TrimSpace(field.ID) != fieldID || field.Default == nil {
			continue
		}
		switch typed := field.Default.(type) {
		case int:
			if typed > 0 {
				result := typed
				return &result
			}
		case int32:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case int64:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case float64:
			if typed > 0 {
				result := int(typed)
				return &result
			}
		case string:
			text := strings.TrimSpace(typed)
			if text == "" {
				return nil
			}
			parsed, err := strconv.Atoi(text)
			if err == nil && parsed > 0 {
				return &parsed
			}
		}
	}
	return nil
}

func preferredProviderForEndpoint(candidates []aiProviderModelCandidate, defaults map[string]string) aiProviderModelCandidate {
	if len(candidates) == 1 {
		return candidates[0]
	}
	endpoint := strings.TrimSpace(candidates[0].provider.Endpoint())
	if providerID := strings.TrimSpace(defaults[endpoint]); providerID != "" {
		for _, candidate := range candidates {
			if candidate.provider.ID() == providerID {
				return candidate
			}
		}
	}
	preferred := candidates[0]
	for _, candidate := range candidates[1:] {
		if strings.TrimSpace(candidate.provider.Created()) == "" {
			continue
		}
		if strings.TrimSpace(preferred.provider.Created()) == "" || candidate.provider.Created() < preferred.provider.Created() {
			preferred = candidate
		}
	}
	return preferred
}

func configStringSlice(config map[string]any, key string) []string {
	raw, ok := config[key]
	if !ok || raw == nil {
		return nil
	}
	switch typed := raw.(type) {
	case []string:
		return typed
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		text := strings.TrimSpace(fmt.Sprint(raw))
		if text == "" {
			return nil
		}
		return []string{text}
	}
}

func firstConfigString(config map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := config[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func isAIProviderNotFound(err error) bool {
	var notFoundErr *aiproviders.NotFoundError
	return errors.As(err, &notFoundErr)
}

type aiProviderCredentialValidator struct {
	app core.App
}

type aiProviderAccountValidator struct {
	app core.App
}

func (v aiProviderCredentialValidator) ValidateCredentialRef(credentialID string, actorID string) error {
	if err := secrets.ValidateRef(v.app, credentialID, actorID); err != nil {
		var resolveErr *secrets.ResolveError
		if errors.As(err, &resolveErr) {
			switch resolveErr.Reason {
			case secrets.ReasonAccessDenied:
				return &aiproviders.AccessDeniedError{Message: "credential is not accessible", Cause: err}
			case secrets.ReasonNotFound, secrets.ReasonRevoked, secrets.ReasonExpired:
				return &aiproviders.ValidationError{Message: "invalid AI provider credential", Cause: err}
			default:
				return &aiproviders.ValidationError{Message: "invalid AI provider credential", Cause: err}
			}
		}
		return err
	}
	return nil
}

func (v aiProviderAccountValidator) ValidateProviderAccountRef(providerAccountID string, actorID string) error {
	_, err := persistence.NewProviderAccountRepository(v.app).Get(providerAccountID)
	if err == nil {
		return nil
	}
	var notFoundErr *accounts.NotFoundError
	if errors.As(err, &notFoundErr) {
		return &aiproviders.ValidationError{Message: "invalid AI provider provider_account", Cause: err}
	}
	return err
}

func writeAIProviderAudit(e *core.RequestEvent, action string, beforeSnap *aiproviders.Snapshot, input aiproviders.SaveInput, after *aiproviders.AIProvider, opErr error) {
	userID, userEmail, ip, userAgent := clientInfo(e)
	entry := audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       action,
		ResourceType: "ai_provider",
		Status:       audit.StatusSuccess,
		IP:           ip,
		UserAgent:    userAgent,
		Detail:       map[string]any{},
	}
	if beforeSnap != nil {
		entry.ResourceID = beforeSnap.ID
		entry.ResourceName = beforeSnap.Name
		entry.Detail["before"] = aiProviderSnapshotMap(beforeSnap)
	}
	if after != nil {
		entry.ResourceID = after.ID()
		entry.ResourceName = after.Name()
		entry.Detail["after"] = aiProviderResponse(after)
	}
	if beforeSnap == nil && after == nil {
		entry.Detail["input"] = aiProviderInputMap(input)
	}
	if opErr != nil {
		entry.Status = audit.StatusFailed
		entry.Detail["errorMessage"] = opErr.Error()
		if _, hasInput := entry.Detail["input"]; !hasInput {
			entry.Detail["input"] = aiProviderInputMap(input)
		}
	}
	audit.Write(e.App, entry)
}

func aiProviderInputMap(input aiproviders.SaveInput) map[string]any {
	return map[string]any{
		"name":             input.Name,
		"kind":             input.Kind,
		"is_default":       input.IsDefault,
		"template_id":      input.TemplateID,
		"endpoint":         input.Endpoint,
		"auth_scheme":      input.AuthScheme,
		"provider_account": input.ProviderAccountID,
		"credential":       input.CredentialID,
		"config":           input.Config,
		"description":      input.Description,
	}
}

func aiProviderSnapshotMap(snap *aiproviders.Snapshot) map[string]any {
	return map[string]any{
		"id":               snap.ID,
		"name":             snap.Name,
		"kind":             snap.Kind,
		"is_default":       snap.IsDefault,
		"template_id":      snap.TemplateID,
		"endpoint":         snap.Endpoint,
		"auth_scheme":      snap.AuthScheme,
		"provider_account": snap.ProviderAccountID,
		"credential":       snap.CredentialID,
		"config":           snap.Config,
		"description":      snap.Description,
	}
}
