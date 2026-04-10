package routes

import (
	"net/http"

	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// registerResourceRoutes registers all Resource Store CRUD routes.
//
// Route groups:
//
//	/api/ext/resources/scripts/*
func registerResourceRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	r := g.Group("/resources")

	registerScriptsCRUD(r)
}

// ═══════════════════════════════════════════════════════════
// Generic helpers
// ═══════════════════════════════════════════════════════════

// resourceError returns a PocketBase-style error response.
func resourceError(e *core.RequestEvent, status int, msg string, err error) error {
	data := map[string]any{}
	if err != nil {
		data["error"] = err.Error()
	}
	return e.JSON(status, map[string]any{
		"code":    status,
		"message": msg,
		"data":    data,
	})
}

// listRecords returns all records from a collection.
func listRecords(e *core.RequestEvent, collection string) error {
	records, err := e.App.FindAllRecords(collection)
	if err != nil {
		return resourceError(e, http.StatusInternalServerError, "failed to list records", err)
	}

	result := make([]map[string]any, 0, len(records))
	for _, r := range records {
		result = append(result, recordToMap(r))
	}
	return e.JSON(http.StatusOK, result)
}

// getRecord returns a single record by ID.
func getRecord(e *core.RequestEvent, collection string) error {
	id := e.Request.PathValue("id")
	record, err := e.App.FindRecordById(collection, id)
	if err != nil {
		return e.NotFoundError("Record not found", err)
	}
	return e.JSON(http.StatusOK, recordToMap(record))
}

// deleteRecord deletes a record by ID.
func deleteRecord(e *core.RequestEvent, collection string) error {
	id := e.Request.PathValue("id")
	record, err := e.App.FindRecordById(collection, id)
	if err != nil {
		return e.NotFoundError("Record not found", err)
	}
	if err := e.App.Delete(record); err != nil {
		return resourceError(e, http.StatusInternalServerError, "failed to delete record", err)
	}
	return e.NoContent(http.StatusNoContent)
}

// recordToMap converts a PocketBase record to a JSON-friendly map.
func recordToMap(r *core.Record) map[string]any {
	m := map[string]any{
		"id":      r.Id,
		"created": r.GetString("created"),
		"updated": r.GetString("updated"),
	}
	// Export all non-hidden public fields
	for _, f := range r.Collection().Fields {
		if f.GetHidden() {
			continue
		}
		name := f.GetName()
		if name == "id" || name == "created" || name == "updated" {
			continue
		}
		m[name] = r.Get(name)
	}
	return m
}

// bindAndSave binds JSON body fields to a record and saves it.
func bindAndSave(e *core.RequestEvent, record *core.Record, fields []string) error {
	var body map[string]any
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("Invalid request body", err)
	}

	for _, f := range fields {
		if v, ok := body[f]; ok {
			record.Set(f, v)
		}
	}

	if err := e.App.Save(record); err != nil {
		return e.BadRequestError("Validation failed", err)
	}
	return e.JSON(http.StatusOK, recordToMap(record))
}

// ═══════════════════════════════════════════════════════════
// Scripts
// ═══════════════════════════════════════════════════════════

var scriptFields = []string{"name", "language", "code", "description"}

func registerScriptsCRUD(r *router.RouterGroup[*core.RequestEvent]) {
	sc := r.Group("/scripts")
	sc.Bind(apis.RequireSuperuserAuth())

	sc.GET("", func(e *core.RequestEvent) error {
		return listRecords(e, "scripts")
	})
	sc.GET("/{id}", func(e *core.RequestEvent) error {
		return getRecord(e, "scripts")
	})
	sc.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId("scripts")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}
		record := core.NewRecord(col)
		return bindAndSave(e, record, scriptFields)
	})
	sc.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("scripts", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		return bindAndSave(e, record, scriptFields)
	})
	sc.DELETE("/{id}", func(e *core.RequestEvent) error {
		return deleteRecord(e, "scripts")
	})
}
