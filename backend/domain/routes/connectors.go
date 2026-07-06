package routes

import (
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	monitorchecks "github.com/websoft9/appos/backend/domain/monitor/signals/checks"
	"github.com/websoft9/appos/backend/domain/resource/accounts"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/domain/secrets"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

type connectorUpsertRequest struct {
	Name              string         `json:"name"`
	Kind              string         `json:"kind"`
	IsEnabled         *bool          `json:"is_enabled,omitempty"`
	TemplateID        string         `json:"template_id"`
	Endpoint          string         `json:"endpoint"`
	AuthScheme        string         `json:"auth_scheme"`
	ProviderAccountID string         `json:"provider_account"`
	CredentialID      string         `json:"credential"`
	Config            map[string]any `json:"config"`
	Description       string         `json:"description"`
}

type connectorResponseDocument struct {
	ID                string         `json:"id"`
	Created           string         `json:"created"`
	Updated           string         `json:"updated"`
	Name              string         `json:"name"`
	Kind              string         `json:"kind"`
	IsEnabled         bool           `json:"is_enabled"`
	TemplateID        string         `json:"template_id"`
	Endpoint          string         `json:"endpoint"`
	AuthScheme        string         `json:"auth_scheme"`
	ProviderAccountID string         `json:"provider_account"`
	CredentialID      string         `json:"credential"`
	Config            map[string]any `json:"config"`
	Description       string         `json:"description"`
}

var _ = connectorResponseDocument{}

type connectorReachabilityItem struct {
	ID            string `json:"id"`
	Status        string `json:"status"`
	LatencyMS     int64  `json:"latency_ms,omitempty"`
	Reason        string `json:"reason,omitempty"`
	Host          string `json:"host,omitempty"`
	Port          int    `json:"port,omitempty"`
	LastCheckedAt string `json:"lastCheckedAt,omitempty"`
}

type connectorReachabilityResponse struct {
	Items []connectorReachabilityItem `json:"items"`
}

// registerConnectorRoutes registers authenticated read routes and superuser-only
// mutation routes for connector resources.

func registerConnectorRoutes(se *core.ServeEvent) {
	group := se.Router.Group("/api/connectors")
	group.Bind(apis.RequireAuth())
	group.GET("/templates", handleConnectorTemplateList)
	group.GET("/templates/{id}", handleConnectorTemplateGet)
	group.GET("", handleConnectorList)
	group.GET("/reachability", handleConnectorReachability)
	group.GET("/{id}", handleConnectorGet)

	mutations := se.Router.Group("/api/connectors")
	mutations.Bind(apis.RequireAuth())
	mutations.Bind(apis.RequireSuperuserAuth())
	mutations.POST("", handleConnectorCreate)
	mutations.PUT("/{id}", handleConnectorUpdate)
	mutations.DELETE("/{id}", handleConnectorDelete)
}

// handleConnectorReachability probes network reachability from AppOS to one or more external services.
//
// @Summary Probe connector reachability
// @Description Probes TCP reachability for one or more external services visible to the authenticated user.
// @Tags Resource
// @Security BearerAuth
// @Param ids query string false "comma-separated connector ids"
// @Success 200 {object} connectorReachabilityResponse
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/connectors/reachability [get]
func handleConnectorReachability(e *core.RequestEvent) error {
	filterIDs := make(map[string]struct{})
	for _, id := range strings.Split(e.Request.URL.Query().Get("ids"), ",") {
		normalized := strings.TrimSpace(id)
		if normalized == "" {
			continue
		}
		filterIDs[normalized] = struct{}{}
	}

	items, err := connectors.List(persistence.NewConnectorRepository(e.App), parseConnectorKindFilter(e.Request.URL.Query().Get("kind")))
	if err != nil {
		return e.InternalServerError("failed to list connectors", err)
	}

	result := make([]connectorReachabilityItem, 0, len(items))
	now := time.Now().UTC()
	timeout := monitorchecks.LoadReachabilityProbeTimeout(e.App)
	for _, snapshot := range monitorchecks.ProbeConnectorBatchWithTimeout(items, timeout) {
		item := snapshot.Item
		if len(filterIDs) > 0 {
			if _, ok := filterIDs[item.ID()]; !ok {
				continue
			}
		}
		row := connectorReachabilityResponseItem(item, snapshot.Result, now)
		if err := monitorchecks.ProjectConnectorReachability(e.App, item, monitorchecks.ReachabilityResult{
			Status:    row.Status,
			LatencyMS: row.LatencyMS,
			Reason:    row.Reason,
			Host:      row.Host,
			Port:      row.Port,
		}, now); err != nil {
			return e.InternalServerError("failed to project connector reachability", err)
		}
		result = append(result, row)
	}
	return e.JSON(http.StatusOK, connectorReachabilityResponse{Items: result})
}

// handleConnectorTemplateList lists built-in connector templates.
//
// @Summary List connector templates
// @Description Returns all built-in connector templates available for connector creation and editing.
// @Tags Resource
// @Security BearerAuth
// @Success 200 {array} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/connectors/templates [get]
func handleConnectorTemplateList(e *core.RequestEvent) error {
	templates, err := connectors.TemplatesWithError()
	if err != nil {
		return e.InternalServerError("failed to load connector templates", err)
	}
	return e.JSON(http.StatusOK, templates)
}

// handleConnectorTemplateGet returns one built-in connector template by id.
//
// @Summary Get connector template
// @Description Returns a single built-in connector template.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "template id"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/connectors/templates/{id} [get]
func handleConnectorTemplateGet(e *core.RequestEvent) error {
	template, ok, err := connectors.FindTemplate(e.Request.PathValue("id"))
	if err != nil {
		return e.InternalServerError("failed to load connector template", err)
	}
	if !ok {
		return e.NotFoundError("connector template not found", nil)
	}
	return e.JSON(http.StatusOK, template)
}

// handleConnectorList lists connectors, optionally filtered by kind.
//
// @Summary List connectors
// @Description Returns connectors visible to the authenticated user. Use the optional kind query parameter to filter by one or more connector kinds.
// @Tags Resource
// @Security BearerAuth
// @Param kind query string false "comma-separated connector kinds"
// @Success 200 {array} connectorResponseDocument
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/connectors [get]
func handleConnectorList(e *core.RequestEvent) error {
	items, err := connectors.List(persistence.NewConnectorRepository(e.App), parseConnectorKindFilter(e.Request.URL.Query().Get("kind")))
	if err != nil {
		return e.InternalServerError("failed to list connectors", err)
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, connectorResponse(item))
	}
	return e.JSON(http.StatusOK, result)
}

// handleConnectorGet returns a connector by id.
//
// @Summary Get connector
// @Description Returns a single connector by id.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "connector id"
// @Success 200 {object} connectorResponseDocument
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/connectors/{id} [get]
func handleConnectorGet(e *core.RequestEvent) error {
	item, err := connectors.Get(persistence.NewConnectorRepository(e.App), e.Request.PathValue("id"))
	if err != nil {
		if isConnectorNotFound(err) {
			return e.NotFoundError("connector not found", err)
		}
		return e.InternalServerError("failed to load connector", err)
	}
	return e.JSON(http.StatusOK, connectorResponse(item))
}

// handleConnectorCreate creates a connector.
//
// @Summary Create connector
// @Description Creates a connector. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param body body connectorUpsertRequest true "connector payload"
// @Success 201 {object} connectorResponseDocument
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/connectors [post]
func handleConnectorCreate(e *core.RequestEvent) error {
	input, err := bindConnectorUpsertRequest(e, nil)
	if err != nil {
		return err
	}
	userID, _ := authInfo(e)
	item, saveErr := connectors.CreateWithDeps(persistence.NewConnectorRepository(e.App), input, connectors.SaveDeps{
		ActorID:                     userID,
		CredentialRefValidator:      connectorCredentialValidator{app: e.App},
		ProviderAccountRefValidator: connectorAccountValidator{app: e.App},
	})
	if saveErr != nil {
		writeConnectorAudit(e, "connector.create", nil, input, nil, saveErr)
		return connectorSaveError(e, saveErr)
	}
	writeConnectorAudit(e, "connector.create", nil, input, item, nil)

	return e.JSON(http.StatusCreated, connectorResponse(item))
}

// handleConnectorUpdate updates an existing connector.
//
// @Summary Update connector
// @Description Updates an existing connector. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "connector id"
// @Param body body connectorUpsertRequest true "connector payload"
// @Success 200 {object} connectorResponseDocument
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/connectors/{id} [put]
func handleConnectorUpdate(e *core.RequestEvent) error {
	repo := persistence.NewConnectorRepository(e.App)
	before, getErr := repo.Get(e.Request.PathValue("id"))
	if getErr != nil {
		if isConnectorNotFound(getErr) {
			return e.NotFoundError("connector not found", getErr)
		}
		return e.InternalServerError("failed to load connector", getErr)
	}
	input, err := bindConnectorUpsertRequest(e, before)
	if err != nil {
		return err
	}
	beforeSnap := before.Snapshot()
	userID, _ := authInfo(e)
	item, saveErr := connectors.UpdateExistingWithDeps(repo, before, input, connectors.SaveDeps{
		ActorID:                     userID,
		CredentialRefValidator:      connectorCredentialValidator{app: e.App},
		ProviderAccountRefValidator: connectorAccountValidator{app: e.App},
	})
	if saveErr != nil {
		writeConnectorAudit(e, "connector.update", &beforeSnap, input, nil, saveErr)
		return connectorSaveError(e, saveErr)
	}
	writeConnectorAudit(e, "connector.update", &beforeSnap, input, item, nil)
	return e.JSON(http.StatusOK, connectorResponse(item))
}

// handleConnectorDelete deletes a connector by id.
//
// @Summary Delete connector
// @Description Deletes a connector. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "connector id"
// @Success 204 {object} nil
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/connectors/{id} [delete]
func handleConnectorDelete(e *core.RequestEvent) error {
	repo := persistence.NewConnectorRepository(e.App)
	before, getErr := repo.Get(e.Request.PathValue("id"))
	if getErr != nil {
		if isConnectorNotFound(getErr) {
			return e.NotFoundError("connector not found", getErr)
		}
		return e.InternalServerError("failed to load connector", getErr)
	}
	beforeSnap := before.Snapshot()
	err := connectors.DeleteExisting(repo, before)
	if err != nil {
		writeConnectorAudit(e, "connector.delete", &beforeSnap, connectors.SaveInput{}, nil, err)
		return e.InternalServerError("failed to delete connector", err)
	}
	writeConnectorAudit(e, "connector.delete", &beforeSnap, connectors.SaveInput{}, nil, nil)
	return e.NoContent(http.StatusNoContent)
}

func bindConnectorUpsertRequest(e *core.RequestEvent, existing *connectors.Connector) (connectors.SaveInput, error) {
	var body connectorUpsertRequest
	if err := e.BindBody(&body); err != nil {
		return connectors.SaveInput{}, e.BadRequestError("invalid JSON body", err)
	}
	if strings.TrimSpace(body.Kind) == connectors.KindLLM {
		return connectors.SaveInput{}, e.BadRequestError("llm connectors are no longer supported on /api/connectors; use /api/ai-providers instead", nil)
	}
	isEnabled := true
	if existing != nil {
		isEnabled = existing.IsEnabled()
	}
	if body.IsEnabled != nil {
		isEnabled = *body.IsEnabled
	}
	return connectors.SaveInput{
		Name:              body.Name,
		Kind:              body.Kind,
		IsEnabled:         isEnabled,
		TemplateID:        body.TemplateID,
		Endpoint:          body.Endpoint,
		AuthScheme:        body.AuthScheme,
		ProviderAccountID: body.ProviderAccountID,
		CredentialID:      body.CredentialID,
		Config:            body.Config,
		Description:       body.Description,
	}, nil
}

func connectorSaveError(e *core.RequestEvent, err error) error {
	var validationErr *connectors.ValidationError
	if errors.As(err, &validationErr) {
		return e.BadRequestError("invalid connector payload", err)
	}
	var accessDeniedErr *connectors.AccessDeniedError
	if errors.As(err, &accessDeniedErr) {
		return apis.NewForbiddenError(accessDeniedErr.Error(), err)
	}
	var conflictErr *connectors.ConflictError
	if errors.As(err, &conflictErr) {
		return apis.NewApiError(http.StatusConflict, conflictErr.Error(), err)
	}
	var notFoundErr *connectors.NotFoundError
	if errors.As(err, &notFoundErr) {
		return e.NotFoundError(notFoundErr.Error(), err)
	}
	return e.InternalServerError("failed to save connector", err)
}

func connectorResponse(item *connectors.Connector) map[string]any {
	return map[string]any{
		"id":               item.ID(),
		"created":          item.Created(),
		"updated":          item.Updated(),
		"name":             item.Name(),
		"kind":             item.Kind(),
		"is_enabled":       item.IsEnabled(),
		"template_id":      item.TemplateID(),
		"endpoint":         item.Endpoint(),
		"auth_scheme":      item.AuthScheme(),
		"provider_account": item.ProviderAccountID(),
		"credential":       item.CredentialID(),
		"config":           item.Config(),
		"description":      item.Description(),
	}
}

func parseConnectorKindFilter(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		kind := strings.TrimSpace(part)
		if kind == "" {
			continue
		}
		result = append(result, kind)
	}
	return result
}

func isConnectorNotFound(err error) bool {
	var notFoundErr *connectors.NotFoundError
	return errors.As(err, &notFoundErr)
}



func connectorReachabilityResponseItem(
	item *connectors.Connector,
	reachability monitorchecks.ReachabilityResult,
	checkedAt time.Time,
) connectorReachabilityItem {
	result := connectorReachabilityItem{
		ID:            item.ID(),
		Status:        reachability.Status,
		LatencyMS:     reachability.LatencyMS,
		Reason:        reachability.Reason,
		Host:          reachability.Host,
		Port:          reachability.Port,
		LastCheckedAt: checkedAt.Format(time.RFC3339),
	}
	return result
}

func connectorProbeTarget(item *connectors.Connector) (string, int, error) {
	raw := strings.TrimSpace(item.Endpoint())
	if raw == "" {
		return "", 0, errors.New("endpoint is empty")
	}
	parsedRaw := raw
	if !strings.Contains(parsedRaw, "://") {
		parsedRaw = "tcp://" + parsedRaw
	}
	parsed, err := url.Parse(parsedRaw)
	if err != nil {
		return "", 0, err
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return "", 0, errors.New("endpoint host is empty")
	}
	port := 0
	if rawPort := strings.TrimSpace(parsed.Port()); rawPort != "" {
		port, err = strconv.Atoi(rawPort)
		if err != nil {
			return host, 0, err
		}
	} else {
		switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
		case "http":
			port = 80
		case "https":
			port = 443
		case "smtp", "tcp":
			port = 587
		case "smtps":
			port = 465
		case "socks5":
			port = 1080
		default:
			return host, 0, errors.New("endpoint port is required")
		}
	}
	return host, port, nil
}

type connectorCredentialValidator struct {
	app core.App
}

type connectorAccountValidator struct {
	app core.App
}

func (v connectorCredentialValidator) ValidateCredentialRef(credentialID string, actorID string) error {
	if err := secrets.ValidateRef(v.app, credentialID, actorID); err != nil {
		var resolveErr *secrets.ResolveError
		if errors.As(err, &resolveErr) {
			switch resolveErr.Reason {
			case secrets.ReasonAccessDenied:
				return &connectors.AccessDeniedError{Message: "credential is not accessible", Cause: err}
			case secrets.ReasonNotFound, secrets.ReasonRevoked, secrets.ReasonExpired:
				return &connectors.ValidationError{Message: "invalid connector credential", Cause: err}
			default:
				return &connectors.ValidationError{Message: "invalid connector credential", Cause: err}
			}
		}
		return err
	}
	return nil
}

func (v connectorAccountValidator) ValidateProviderAccountRef(providerAccountID string, actorID string) error {
	_, err := persistence.NewProviderAccountRepository(v.app).Get(providerAccountID)
	if err == nil {
		return nil
	}
	var notFoundErr *accounts.NotFoundError
	if errors.As(err, &notFoundErr) {
		return &connectors.ValidationError{Message: "invalid connector provider_account", Cause: err}
	}
	return err
}

func writeConnectorAudit(e *core.RequestEvent, action string, beforeSnap *connectors.Snapshot, input connectors.SaveInput, after *connectors.Connector, opErr error) {
	userID, userEmail, ip, userAgent := clientInfo(e)
	entry := audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       action,
		ResourceType: "connector",
		Status:       audit.StatusSuccess,
		IP:           ip,
		UserAgent:    userAgent,
		Detail:       map[string]any{},
	}
	if beforeSnap != nil {
		entry.ResourceID = beforeSnap.ID
		entry.ResourceName = beforeSnap.Name
		entry.Detail["before"] = connectorSnapshotMap(beforeSnap)
	}
	if after != nil {
		entry.ResourceID = after.ID()
		entry.ResourceName = after.Name()
		entry.Detail["after"] = connectorResponse(after)
	}
	if beforeSnap == nil && after == nil {
		entry.Detail["input"] = connectorInputMap(input)
	}
	if opErr != nil {
		entry.Status = audit.StatusFailed
		entry.Detail["errorMessage"] = opErr.Error()
		if _, hasInput := entry.Detail["input"]; !hasInput {
			entry.Detail["input"] = connectorInputMap(input)
		}
	}
	audit.Write(e.App, entry)
}

func connectorInputMap(input connectors.SaveInput) map[string]any {
	return map[string]any{
		"name":             input.Name,
		"kind":             input.Kind,
		"is_enabled":       input.IsEnabled,
		"template_id":      input.TemplateID,
		"endpoint":         input.Endpoint,
		"auth_scheme":      input.AuthScheme,
		"provider_account": input.ProviderAccountID,
		"credential":       input.CredentialID,
		"config":           input.Config,
		"description":      input.Description,
	}
}

func connectorSnapshotMap(snap *connectors.Snapshot) map[string]any {
	return map[string]any{
		"id":               snap.ID,
		"name":             snap.Name,
		"kind":             snap.Kind,
		"is_enabled":       snap.IsEnabled,
		"template_id":      snap.TemplateID,
		"endpoint":         snap.Endpoint,
		"auth_scheme":      snap.AuthScheme,
		"provider_account": snap.ProviderAccountID,
		"credential":       snap.CredentialID,
		"config":           snap.Config,
		"description":      snap.Description,
	}
}
