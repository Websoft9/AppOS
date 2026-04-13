package routes

import (
	"errors"
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/resource/accounts"
	"github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/domain/secrets"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

type aiProviderUpsertRequest struct {
	Name              string         `json:"name"`
	Kind              string         `json:"kind"`
	IsDefault         bool           `json:"is_default"`
	TemplateID        string         `json:"template_id"`
	Endpoint          string         `json:"endpoint"`
	AuthScheme        string         `json:"auth_scheme"`
	ProviderAccountID string         `json:"provider_account"`
	CredentialID      string         `json:"credential"`
	Config            map[string]any `json:"config"`
	Description       string         `json:"description"`
}

type aiProviderResponseDocument struct {
	ID                string         `json:"id"`
	Created           string         `json:"created"`
	Updated           string         `json:"updated"`
	Name              string         `json:"name"`
	Kind              string         `json:"kind"`
	IsDefault         bool           `json:"is_default"`
	TemplateID        string         `json:"template_id"`
	Endpoint          string         `json:"endpoint"`
	AuthScheme        string         `json:"auth_scheme"`
	ProviderAccountID string         `json:"provider_account"`
	CredentialID      string         `json:"credential"`
	Config            map[string]any `json:"config"`
	Description       string         `json:"description"`
}

func registerAIProviderRoutes(se *core.ServeEvent) {
	group := se.Router.Group("/api/ai-providers")
	group.Bind(apis.RequireAuth())
	group.GET("/templates", handleAIProviderTemplateList)
	group.GET("/templates/{id}", handleAIProviderTemplateGet)
	group.GET("", handleAIProviderList)
	group.GET("/{id}", handleAIProviderGet)

	mutations := se.Router.Group("/api/ai-providers")
	mutations.Bind(apis.RequireAuth())
	mutations.Bind(apis.RequireSuperuserAuth())
	mutations.POST("", handleAIProviderCreate)
	mutations.PUT("/{id}", handleAIProviderUpdate)
	mutations.DELETE("/{id}", handleAIProviderDelete)
}

func handleAIProviderTemplateList(e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, aiproviders.Templates())
}

func handleAIProviderTemplateGet(e *core.RequestEvent) error {
	template, ok := aiproviders.FindTemplate(e.Request.PathValue("id"))
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
	input, err := bindAIProviderUpsertRequest(e)
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
	input, err := bindAIProviderUpsertRequest(e)
	if err != nil {
		return err
	}
	repo := persistence.NewAIProviderRepository(e.App)
	before, getErr := repo.Get(e.Request.PathValue("id"))
	if getErr != nil {
		if isAIProviderNotFound(getErr) {
			return e.NotFoundError("AI provider not found", getErr)
		}
		return e.InternalServerError("failed to load AI provider", getErr)
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
	err := aiproviders.DeleteExisting(repo, before)
	if err != nil {
		writeAIProviderAudit(e, "ai_provider.delete", &beforeSnap, aiproviders.SaveInput{}, nil, err)
		return e.InternalServerError("failed to delete AI provider", err)
	}
	writeAIProviderAudit(e, "ai_provider.delete", &beforeSnap, aiproviders.SaveInput{}, nil, nil)
	return e.NoContent(http.StatusNoContent)
}

func bindAIProviderUpsertRequest(e *core.RequestEvent) (aiproviders.SaveInput, error) {
	var body aiProviderUpsertRequest
	if err := e.BindBody(&body); err != nil {
		return aiproviders.SaveInput{}, e.BadRequestError("invalid JSON body", err)
	}
	return aiproviders.SaveInput{
		Name:              body.Name,
		Kind:              body.Kind,
		IsDefault:         body.IsDefault,
		TemplateID:        body.TemplateID,
		Endpoint:          body.Endpoint,
		AuthScheme:        body.AuthScheme,
		ProviderAccountID: body.ProviderAccountID,
		CredentialID:      body.CredentialID,
		Config:            body.Config,
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

func aiProviderResponse(item *aiproviders.AIProvider) map[string]any {
	return map[string]any{
		"id":               item.ID(),
		"created":          item.Created(),
		"updated":          item.Updated(),
		"name":             item.Name(),
		"kind":             item.Kind(),
		"is_default":       item.IsDefault(),
		"template_id":      item.TemplateID(),
		"endpoint":         item.Endpoint(),
		"auth_scheme":      item.AuthScheme(),
		"provider_account": item.ProviderAccountID(),
		"credential":       item.CredentialID(),
		"config":           item.Config(),
		"description":      item.Description(),
	}
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
			case secrets.ReasonNotFound, secrets.ReasonRevoked:
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
