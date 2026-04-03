package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/resource/endpoints"
)

// Endpoints:
//   - GET    /api/endpoints
//   - POST   /api/endpoints
//   - GET    /api/endpoints/{id}
//   - PUT    /api/endpoints/{id}
//   - DELETE /api/endpoints/{id}
func registerEndpointsRoutes(se *core.ServeEvent) {
	g := se.Router.Group("/api/endpoints")
	g.Bind(apis.RequireAuth())
	g.Bind(apis.RequireSuperuserAuth())

	g.GET("", func(e *core.RequestEvent) error {
		return listRecords(e, endpoints.Collection)
	})
	g.GET("/{id}", func(e *core.RequestEvent) error {
		return getRecord(e, endpoints.Collection)
	})
	g.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId(endpoints.Collection)
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}
		record := core.NewRecord(col)
		return bindAndSave(e, record, endpoints.EditableFields)
	})
	g.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById(endpoints.Collection, id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		return bindAndSave(e, record, endpoints.EditableFields)
	})
	g.DELETE("/{id}", func(e *core.RequestEvent) error {
		return deleteRecord(e, endpoints.Collection)
	})
}