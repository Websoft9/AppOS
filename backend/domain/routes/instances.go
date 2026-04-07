package routes

import (
	"errors"
	"net/http"
	"strings"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/audit"
	"github.com/websoft9/appos/backend/domain/resource/instances"
	"github.com/websoft9/appos/backend/domain/secrets"
	persistence "github.com/websoft9/appos/backend/infra/persistence"
)

type instanceUpsertRequest struct {
	Name         string         `json:"name"`
	Kind         string         `json:"kind"`
	TemplateID   string         `json:"template_id"`
	Endpoint     string         `json:"endpoint"`
	CredentialID string         `json:"credential"`
	Config       map[string]any `json:"config"`
	Description  string         `json:"description"`
}

func registerInstanceRoutes(se *core.ServeEvent) {
	group := se.Router.Group("/api/instances")
	group.Bind(apis.RequireAuth())
	group.GET("/templates", handleInstanceTemplateList)
	group.GET("/templates/{id}", handleInstanceTemplateGet)
	group.GET("", handleInstanceList)
	group.GET("/{id}", handleInstanceGet)

	mutations := se.Router.Group("/api/instances")
	mutations.Bind(apis.RequireAuth())
	mutations.Bind(apis.RequireSuperuserAuth())
	mutations.POST("", handleInstanceCreate)
	mutations.PUT("/{id}", handleInstanceUpdate)
	mutations.DELETE("/{id}", handleInstanceDelete)
}

// @Summary List instance templates
// @Description Returns all built-in instance templates available for service-instance creation and editing.
// @Tags Resource
// @Security BearerAuth
// @Success 200 {array} map[string]any
// @Failure 401 {object} map[string]any
// @Router /api/instances/templates [get]
func handleInstanceTemplateList(e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, instances.Templates())
}

// @Summary Get instance template
// @Description Returns a single built-in instance template.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "template id"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/instances/templates/{id} [get]
func handleInstanceTemplateGet(e *core.RequestEvent) error {
	template, ok := instances.FindTemplate(e.Request.PathValue("id"))
	if !ok {
		return e.NotFoundError("instance template not found", nil)
	}
	return e.JSON(http.StatusOK, template)
}

// @Summary List instances
// @Description Returns service instances visible to the authenticated user. Use the optional kind query parameter to filter by one or more instance kinds.
// @Tags Resource
// @Security BearerAuth
// @Param kind query string false "comma-separated instance kinds"
// @Success 200 {array} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/instances [get]
func handleInstanceList(e *core.RequestEvent) error {
	items, err := instances.List(persistence.NewInstanceRepository(e.App), parseInstanceKindFilter(e.Request.URL.Query().Get("kind")))
	if err != nil {
		return e.InternalServerError("failed to list instances", err)
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, item.ResponseMap())
	}
	return e.JSON(http.StatusOK, result)
}

// @Summary Get instance
// @Description Returns a single service instance by id.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "instance id"
// @Success 200 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Router /api/instances/{id} [get]
func handleInstanceGet(e *core.RequestEvent) error {
	item, err := instances.Get(persistence.NewInstanceRepository(e.App), e.Request.PathValue("id"))
	if err != nil {
		if isInstanceNotFound(err) {
			return e.NotFoundError("instance not found", err)
		}
		return e.InternalServerError("failed to load instance", err)
	}
	return e.JSON(http.StatusOK, item.ResponseMap())
}

// @Summary Create instance
// @Description Creates a service instance. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param body body instanceUpsertRequest true "instance payload"
// @Success 201 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/instances [post]
func handleInstanceCreate(e *core.RequestEvent) error {
	input, err := bindInstanceUpsertRequest(e)
	if err != nil {
		return err
	}
	if err := validateInstanceCredentialRef(e, input); err != nil {
		return err
	}
	item, saveErr := instances.Create(persistence.NewInstanceRepository(e.App), input)
	if saveErr != nil {
		writeInstanceAudit(e, "instance.create", nil, input, nil, saveErr)
		return instanceSaveError(e, saveErr)
	}
	writeInstanceAudit(e, "instance.create", nil, input, item, nil)
	return e.JSON(http.StatusCreated, item.ResponseMap())
}

// @Summary Update instance
// @Description Updates an existing service instance. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "instance id"
// @Param body body instanceUpsertRequest true "instance payload"
// @Success 200 {object} map[string]any
// @Failure 400 {object} map[string]any
// @Failure 401 {object} map[string]any
// @Failure 403 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/instances/{id} [put]
func handleInstanceUpdate(e *core.RequestEvent) error {
	input, err := bindInstanceUpsertRequest(e)
	if err != nil {
		return err
	}
	if err := validateInstanceCredentialRef(e, input); err != nil {
		return err
	}
	repo := persistence.NewInstanceRepository(e.App)
	before, getErr := repo.Get(e.Request.PathValue("id"))
	if getErr != nil {
		if isInstanceNotFound(getErr) {
			return e.NotFoundError("instance not found", getErr)
		}
		return e.InternalServerError("failed to load instance", getErr)
	}
	beforeSnap := before.Snapshot()
	item, saveErr := instances.UpdateExisting(repo, before, input)
	if saveErr != nil {
		writeInstanceAudit(e, "instance.update", &beforeSnap, input, nil, saveErr)
		return instanceSaveError(e, saveErr)
	}
	writeInstanceAudit(e, "instance.update", &beforeSnap, input, item, nil)
	return e.JSON(http.StatusOK, item.ResponseMap())
}

// @Summary Delete instance
// @Description Deletes a service instance. Superuser only.
// @Tags Resource
// @Security BearerAuth
// @Param id path string true "instance id"
// @Success 204 {object} nil
// @Failure 401 {object} map[string]any
// @Failure 404 {object} map[string]any
// @Failure 500 {object} map[string]any
// @Router /api/instances/{id} [delete]
func handleInstanceDelete(e *core.RequestEvent) error {
	repo := persistence.NewInstanceRepository(e.App)
	before, getErr := repo.Get(e.Request.PathValue("id"))
	if getErr != nil {
		if isInstanceNotFound(getErr) {
			return e.NotFoundError("instance not found", getErr)
		}
		return e.InternalServerError("failed to load instance", getErr)
	}
	beforeSnap := before.Snapshot()
	err := instances.DeleteExisting(repo, before)
	if err != nil {
		writeInstanceAudit(e, "instance.delete", &beforeSnap, instances.SaveInput{}, nil, err)
		return e.InternalServerError("failed to delete instance", err)
	}
	writeInstanceAudit(e, "instance.delete", &beforeSnap, instances.SaveInput{}, nil, nil)
	return e.NoContent(http.StatusNoContent)
}

func bindInstanceUpsertRequest(e *core.RequestEvent) (instances.SaveInput, error) {
	var body instanceUpsertRequest
	if err := e.BindBody(&body); err != nil {
		return instances.SaveInput{}, e.BadRequestError("invalid JSON body", err)
	}
	return instances.SaveInput{
		Name:         body.Name,
		Kind:         body.Kind,
		TemplateID:   body.TemplateID,
		Endpoint:     body.Endpoint,
		CredentialID: body.CredentialID,
		Config:       body.Config,
		Description:  body.Description,
	}, nil
}

func instanceSaveError(e *core.RequestEvent, err error) error {
	var validationErr *instances.ValidationError
	if errors.As(err, &validationErr) {
		return e.BadRequestError("invalid instance payload", err)
	}
	return e.InternalServerError("failed to save instance", err)
}

func parseInstanceKindFilter(raw string) []string {
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

func isInstanceNotFound(err error) bool {
	var notFoundErr *instances.NotFoundError
	return errors.As(err, &notFoundErr)
}

func validateInstanceCredentialRef(e *core.RequestEvent, input instances.SaveInput) error {
	credentialID := strings.TrimSpace(input.CredentialID)
	if credentialID == "" {
		return nil
	}
	userID, _ := authInfo(e)
	if err := secrets.ValidateRef(e.App, credentialID, userID); err != nil {
		var resolveErr *secrets.ResolveError
		if errors.As(err, &resolveErr) {
			switch resolveErr.Reason {
			case secrets.ReasonAccessDenied:
				return apis.NewForbiddenError("credential is not accessible", err)
			case secrets.ReasonNotFound, secrets.ReasonRevoked:
				return e.BadRequestError("invalid instance credential", err)
			default:
				return e.BadRequestError("invalid instance credential", err)
			}
		}
		return e.InternalServerError("failed to validate instance credential", err)
	}
	return nil
}

func writeInstanceAudit(e *core.RequestEvent, action string, beforeSnap *instances.Snapshot, input instances.SaveInput, after *instances.Instance, opErr error) {
	userID, userEmail, ip, userAgent := clientInfo(e)
	entry := audit.Entry{
		UserID:       userID,
		UserEmail:    userEmail,
		Action:       action,
		ResourceType: "instance",
		Status:       audit.StatusSuccess,
		IP:           ip,
		UserAgent:    userAgent,
		Detail:       map[string]any{},
	}
	if beforeSnap != nil {
		entry.ResourceID = beforeSnap.ID
		entry.ResourceName = beforeSnap.Name
		entry.Detail["before"] = instanceSnapshotMap(beforeSnap)
	}
	if after != nil {
		entry.ResourceID = after.ID()
		entry.ResourceName = after.Name()
		entry.Detail["after"] = after.ResponseMap()
	}
	if beforeSnap == nil && after == nil {
		entry.Detail["input"] = instanceInputMap(input)
	}
	if opErr != nil {
		entry.Status = audit.StatusFailed
		entry.Detail["errorMessage"] = opErr.Error()
		if _, hasInput := entry.Detail["input"]; !hasInput {
			entry.Detail["input"] = instanceInputMap(input)
		}
	}
	audit.Write(e.App, entry)
}

func instanceInputMap(input instances.SaveInput) map[string]any {
	return map[string]any{
		"name":        input.Name,
		"kind":        input.Kind,
		"template_id": input.TemplateID,
		"endpoint":    input.Endpoint,
		"credential":  input.CredentialID,
		"config":      input.Config,
		"description": input.Description,
	}
}

func instanceSnapshotMap(snap *instances.Snapshot) map[string]any {
	return map[string]any{
		"id":          snap.ID,
		"name":        snap.Name,
		"kind":        snap.Kind,
		"template_id": snap.TemplateID,
		"endpoint":    snap.Endpoint,
		"credential":  snap.CredentialID,
		"config":      snap.Config,
		"description": snap.Description,
	}
}
