package routes

import (
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/resource/accounts"
	"github.com/websoft9/appos/backend/domain/secrets"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

type providerAccountUpsertRequest struct {
	Name         string         `json:"name"`
	Kind         string         `json:"kind"`
	TemplateID   string         `json:"template_id"`
	Identifier   string         `json:"identifier"`
	CredentialID string         `json:"credential"`
	Config       map[string]any `json:"config"`
	Description  string         `json:"description"`
}

type providerAccountResponseDocument struct {
	ID           string         `json:"id"`
	Created      string         `json:"created"`
	Updated      string         `json:"updated"`
	Name         string         `json:"name"`
	Kind         string         `json:"kind"`
	TemplateID   string         `json:"template_id"`
	Identifier   string         `json:"identifier"`
	CredentialID string         `json:"credential"`
	Config       map[string]any `json:"config"`
	Description  string         `json:"description"`
}

var _ = providerAccountResponseDocument{}

func registerProviderAccountRoutes(se *core.ServeEvent) {
	group := se.Router.Group("/api/provider-accounts")
	group.Bind(apis.RequireAuth())
	group.GET("/templates", handleProviderAccountTemplateList)
	group.GET("/templates/{id}", handleProviderAccountTemplateGet)
	group.GET("", handleProviderAccountList)
	group.GET("/{id}", handleProviderAccountGet)

	mutations := se.Router.Group("/api/provider-accounts")
	mutations.Bind(apis.RequireAuth())
	mutations.Bind(apis.RequireSuperuserAuth())
	mutations.POST("", handleProviderAccountCreate)
	mutations.PUT("/{id}", handleProviderAccountUpdate)
	mutations.DELETE("/{id}", handleProviderAccountDelete)
}

// @Summary List provider account templates
// @Description Returns all built-in provider account templates available for platform-account creation and editing.
// @Tags Resource
// @Security BearerAuth
// @Success 200 {array} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/provider-accounts/templates [get]
func handleProviderAccountTemplateList(e *core.RequestEvent) error {
	templates, err := accounts.Templates()
	if err != nil {
		return e.InternalServerError("failed to load provider account templates", err)
	}
	return e.JSON(http.StatusOK, templates)
}

// @Summary Get provider account template
// @Description Returns a single built-in provider account template.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "template id"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/provider-accounts/templates/{id} [get]
func handleProviderAccountTemplateGet(e *core.RequestEvent) error {
	template, ok, err := accounts.FindTemplate(e.Request.PathValue("id"))
	if err != nil {
		return e.InternalServerError("failed to load provider account template", err)
	}
	if !ok {
		return e.NotFoundError("provider account template not found", nil)
	}
	return e.JSON(http.StatusOK, template)
}

// @Summary List provider accounts
// @Description Returns provider accounts visible to the authenticated user. Use the optional kind query parameter to filter by one or more provider-account kinds.
// @Tags Resource
// @Security BearerAuth
// @Param kind query string false "comma-separated provider-account kinds"
// @Success 200 {array} providerAccountResponseDocument
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/provider-accounts [get]
func handleProviderAccountList(e *core.RequestEvent) error {
	items, err := accounts.List(persistence.NewProviderAccountRepository(e.App), parseProviderAccountKindFilter(e.Request.URL.Query().Get("kind")))
	if err != nil {
		return e.InternalServerError("failed to list provider accounts", err)
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, providerAccountResponse(item))
	}
	return e.JSON(http.StatusOK, result)
}

// @Summary Get provider account
// @Description Returns a single provider account by id.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "provider account id"
// @Success 200 {object} providerAccountResponseDocument
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/provider-accounts/{id} [get]
func handleProviderAccountGet(e *core.RequestEvent) error {
	item, err := accounts.Get(persistence.NewProviderAccountRepository(e.App), e.Request.PathValue("id"))
	if err != nil {
		if isProviderAccountNotFound(err) {
			return e.NotFoundError("provider account not found", err)
		}
		return e.InternalServerError("failed to load provider account", err)
	}
	return e.JSON(http.StatusOK, providerAccountResponse(item))
}

// @Summary Create provider account
// @Description Creates a provider account. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param body body providerAccountUpsertRequest true "provider account payload"
// @Success 201 {object} providerAccountResponseDocument
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/provider-accounts [post]
func handleProviderAccountCreate(e *core.RequestEvent) error {
	input, err := bindProviderAccountUpsertRequest(e)
	if err != nil {
		return err
	}
	userID, _ := authInfo(e)
	item, saveErr := accounts.CreateWithDeps(persistence.NewProviderAccountRepository(e.App), input, accounts.SaveDeps{
		ActorID:                userID,
		CredentialRefValidator: providerAccountCredentialValidator{app: e.App},
	})
	if saveErr != nil {
		writeProviderAccountAudit(e, "provider_account.create", nil, input, nil, saveErr)
		return providerAccountSaveError(e, saveErr)
	}
	writeProviderAccountAudit(e, "provider_account.create", nil, input, item, nil)
	return e.JSON(http.StatusCreated, providerAccountResponse(item))
}

// @Summary Update provider account
// @Description Updates an existing provider account. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "provider account id"
// @Param body body providerAccountUpsertRequest true "provider account payload"
// @Success 200 {object} providerAccountResponseDocument
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/provider-accounts/{id} [put]
func handleProviderAccountUpdate(e *core.RequestEvent) error {
	input, err := bindProviderAccountUpsertRequest(e)
	if err != nil {
		return err
	}
	repo := persistence.NewProviderAccountRepository(e.App)
	before, getErr := repo.Get(e.Request.PathValue("id"))
	if getErr != nil {
		if isProviderAccountNotFound(getErr) {
			return e.NotFoundError("provider account not found", getErr)
		}
		return e.InternalServerError("failed to load provider account", getErr)
	}
	beforeSnap := before.Snapshot()
	userID, _ := authInfo(e)
	item, saveErr := accounts.UpdateExistingWithDeps(repo, before, input, accounts.SaveDeps{
		ActorID:                userID,
		CredentialRefValidator: providerAccountCredentialValidator{app: e.App},
	})
	if saveErr != nil {
		writeProviderAccountAudit(e, "provider_account.update", &beforeSnap, input, nil, saveErr)
		return providerAccountSaveError(e, saveErr)
	}
	writeProviderAccountAudit(e, "provider_account.update", &beforeSnap, input, item, nil)
	return e.JSON(http.StatusOK, providerAccountResponse(item))
}

// @Summary Delete provider account
// @Description Deletes a provider account. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "provider account id"
// @Success 204 {object} nil
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/provider-accounts/{id} [delete]
func handleProviderAccountDelete(e *core.RequestEvent) error {
	repo := persistence.NewProviderAccountRepository(e.App)
	before, getErr := repo.Get(e.Request.PathValue("id"))
	if getErr != nil {
		if isProviderAccountNotFound(getErr) {
			return e.NotFoundError("provider account not found", getErr)
		}
		return e.InternalServerError("failed to load provider account", getErr)
	}
	beforeSnap := before.Snapshot()
	err := accounts.DeleteExisting(repo, before)
	if err != nil {
		writeProviderAccountAudit(e, "provider_account.delete", &beforeSnap, accounts.SaveInput{}, nil, err)
		return providerAccountSaveError(e, err)
	}
	writeProviderAccountAudit(e, "provider_account.delete", &beforeSnap, accounts.SaveInput{}, nil, nil)
	return e.NoContent(http.StatusNoContent)
}

func bindProviderAccountUpsertRequest(e *core.RequestEvent) (accounts.SaveInput, error) {
	var body providerAccountUpsertRequest
	if err := e.BindBody(&body); err != nil {
		return accounts.SaveInput{}, e.BadRequestError("invalid JSON body", err)
	}
	return accounts.SaveInput{
		Name:         body.Name,
		Kind:         body.Kind,
		TemplateID:   body.TemplateID,
		Identifier:   body.Identifier,
		CredentialID: body.CredentialID,
		Config:       body.Config,
		Description:  body.Description,
	}, nil
}

func providerAccountSaveError(e *core.RequestEvent, err error) error {
	var validationErr *accounts.ValidationError
	if errors.As(err, &validationErr) {
		return e.BadRequestError("invalid provider account payload", err)
	}
	var referencedErr *accounts.ReferencedByResourcesError
	if errors.As(err, &referencedErr) {
		return e.JSON(http.StatusConflict, map[string]any{
			"code":    http.StatusConflict,
			"message": "provider account is still referenced; remove related instances, AI providers, or connectors first",
			"data": map[string]any{
				"reason_code": "provider_account_referenced",
				"error":       err.Error(),
			},
		})
	}
	var accessDeniedErr *accounts.AccessDeniedError
	if errors.As(err, &accessDeniedErr) {
		return apis.NewForbiddenError(accessDeniedErr.Error(), err)
	}
	var conflictErr *accounts.ConflictError
	if errors.As(err, &conflictErr) {
		return apis.NewApiError(http.StatusConflict, conflictErr.Error(), err)
	}
	var notFoundErr *accounts.NotFoundError
	if errors.As(err, &notFoundErr) {
		return e.NotFoundError(notFoundErr.Error(), err)
	}
	return e.InternalServerError("failed to save provider account", err)
}

func parseProviderAccountKindFilter(raw string) []string {
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

func isProviderAccountNotFound(err error) bool {
	var notFoundErr *accounts.NotFoundError
	return errors.As(err, &notFoundErr)
}

type providerAccountCredentialValidator struct {
	app core.App
}

func (v providerAccountCredentialValidator) ValidateCredentialRef(credentialID string, actorID string) error {
	if err := secrets.ValidateRef(v.app, credentialID, actorID); err != nil {
		var resolveErr *secrets.ResolveError
		if errors.As(err, &resolveErr) {
			switch resolveErr.Reason {
			case secrets.ReasonAccessDenied:
				return &accounts.AccessDeniedError{Message: "credential is not accessible", Cause: err}
			case secrets.ReasonNotFound, secrets.ReasonRevoked, secrets.ReasonExpired:
				return &accounts.ValidationError{Message: "invalid provider account credential", Cause: err}
			default:
				return &accounts.ValidationError{Message: "invalid provider account credential", Cause: err}
			}
		}
		return err
	}
	return nil
}

func writeProviderAccountAudit(e *core.RequestEvent, action string, beforeSnap *accounts.Snapshot, input accounts.SaveInput, after *accounts.ProviderAccount, opErr error) {
	userID, userEmail, ip, userAgent := clientInfo(e)
	entry := audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       action,
		ResourceType: "provider_account",
		Status:       audit.StatusSuccess,
		IP:           ip,
		UserAgent:    userAgent,
		Detail:       map[string]any{},
	}
	if beforeSnap != nil {
		entry.ResourceID = beforeSnap.ID
		entry.ResourceName = beforeSnap.Name
		entry.Detail["before"] = providerAccountSnapshotMap(beforeSnap)
	}
	if after != nil {
		entry.ResourceID = after.ID()
		entry.ResourceName = after.Name()
		entry.Detail["after"] = providerAccountResponse(after)
	}
	if beforeSnap == nil && after == nil {
		entry.Detail["input"] = providerAccountInputMap(input)
	}
	if opErr != nil {
		entry.Status = audit.StatusFailed
		entry.Detail["errorMessage"] = opErr.Error()
		if _, hasInput := entry.Detail["input"]; !hasInput {
			entry.Detail["input"] = providerAccountInputMap(input)
		}
	}
	audit.Write(e.App, entry)
}

func providerAccountResponse(item *accounts.ProviderAccount) map[string]any {
	return map[string]any{
		"id":          item.ID(),
		"created":     item.Created(),
		"updated":     item.Updated(),
		"name":        item.Name(),
		"kind":        item.Kind(),
		"template_id": item.TemplateID(),
		"identifier":  item.Identifier(),
		"credential":  item.CredentialID(),
		"config":      item.Config(),
		"description": item.Description(),
	}
}

func providerAccountSnapshotMap(snapshot *accounts.Snapshot) map[string]any {
	if snapshot == nil {
		return nil
	}
	return map[string]any{
		"id":          snapshot.ID,
		"created":     snapshot.Created,
		"updated":     snapshot.Updated,
		"name":        snapshot.Name,
		"kind":        snapshot.Kind,
		"template_id": snapshot.TemplateID,
		"identifier":  snapshot.Identifier,
		"credential":  snapshot.CredentialID,
		"config":      snapshot.Config,
		"description": snapshot.Description,
	}
}

func providerAccountInputMap(input accounts.SaveInput) map[string]any {
	return map[string]any{
		"name":        input.Name,
		"kind":        input.Kind,
		"template_id": input.TemplateID,
		"identifier":  input.Identifier,
		"credential":  input.CredentialID,
		"config":      input.Config,
		"description": input.Description,
	}
}
