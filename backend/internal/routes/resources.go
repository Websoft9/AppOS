package routes

import (
	"net/http"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"

	"github.com/websoft9/appos/backend/internal/crypto"
)

// registerResourceRoutes registers all Resource Store CRUD routes.
//
// Route groups:
//
//	/api/ext/resources/servers/*
//	/api/ext/resources/secrets/*
//	/api/ext/resources/env-groups/*
//	/api/ext/resources/databases/*
//	/api/ext/resources/cloud-accounts/*
//	/api/ext/resources/certificates/*
//	/api/ext/resources/integrations/*
//	/api/ext/resources/scripts/*
func registerResourceRoutes(g *router.RouterGroup[*core.RequestEvent]) {
	r := g.Group("/resources")

	registerServersCRUD(r)
	registerSecretsCRUD(r)
	registerEnvGroupsCRUD(r)
	registerDatabasesCRUD(r)
	registerCloudAccountsCRUD(r)
	registerCertificatesCRUD(r)
	registerIntegrationsCRUD(r)
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
// Servers
// ═══════════════════════════════════════════════════════════

var serverFields = []string{"name", "host", "port", "user", "auth_type", "credential", "description"}

func registerServersCRUD(r *router.RouterGroup[*core.RequestEvent]) {
	s := r.Group("/servers")
	s.Bind(apis.RequireSuperuserAuth())

	s.GET("", func(e *core.RequestEvent) error {
		return listRecords(e, "servers")
	})
	s.GET("/{id}", func(e *core.RequestEvent) error {
		return getRecord(e, "servers")
	})
	s.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId("servers")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}
		record := core.NewRecord(col)
		return bindAndSave(e, record, serverFields)
	})
	s.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("servers", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		return bindAndSave(e, record, serverFields)
	})
	s.DELETE("/{id}", func(e *core.RequestEvent) error {
		return deleteRecord(e, "servers")
	})
}

// ═══════════════════════════════════════════════════════════
// Secrets (value encrypted at rest)
// ═══════════════════════════════════════════════════════════

var secretFields = []string{"name", "type", "description"}

func registerSecretsCRUD(r *router.RouterGroup[*core.RequestEvent]) {
	s := r.Group("/secrets")
	s.Bind(apis.RequireSuperuserAuth())

	// List — value field always omitted (hidden)
	s.GET("", func(e *core.RequestEvent) error {
		return listRecords(e, "secrets")
	})

	// Get — value decrypted and returned (superuser only)
	s.GET("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("secrets", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		m := recordToMap(record)

		// Decrypt the value for superuser view
		encryptedValue := record.GetString("value")
		if encryptedValue != "" {
			plaintext, err := crypto.Decrypt(encryptedValue)
			if err != nil {
				return resourceError(e, http.StatusInternalServerError, "failed to decrypt secret value", err)
			}
			m["value"] = plaintext
		} else {
			m["value"] = ""
		}
		return e.JSON(http.StatusOK, m)
	})

	// Create — encrypt value before saving
	s.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId("secrets")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}

		var body map[string]any
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request body", err)
		}

		record := core.NewRecord(col)
		for _, f := range secretFields {
			if v, ok := body[f]; ok {
				record.Set(f, v)
			}
		}

		// Encrypt the value
		if rawValue, ok := body["value"].(string); ok && rawValue != "" {
			encrypted, err := crypto.Encrypt(rawValue)
			if err != nil {
				return resourceError(e, http.StatusInternalServerError, "failed to encrypt secret value", err)
			}
			record.Set("value", encrypted)
		}

		if err := e.App.Save(record); err != nil {
			return e.BadRequestError("Validation failed", err)
		}

		m := recordToMap(record)
		m["value"] = "***" // never return actual value on create
		return e.JSON(http.StatusOK, m)
	})

	// Update — re-encrypt value if provided
	s.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("secrets", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}

		var body map[string]any
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request body", err)
		}

		for _, f := range secretFields {
			if v, ok := body[f]; ok {
				record.Set(f, v)
			}
		}

		// Re-encrypt value only if a new value is provided
		if rawValue, ok := body["value"].(string); ok && rawValue != "" {
			encrypted, err := crypto.Encrypt(rawValue)
			if err != nil {
				return resourceError(e, http.StatusInternalServerError, "failed to encrypt secret value", err)
			}
			record.Set("value", encrypted)
		}

		if err := e.App.Save(record); err != nil {
			return e.BadRequestError("Validation failed", err)
		}

		m := recordToMap(record)
		m["value"] = "***" // never return actual value on update
		return e.JSON(http.StatusOK, m)
	})

	s.DELETE("/{id}", func(e *core.RequestEvent) error {
		return deleteRecord(e, "secrets")
	})
}

// ═══════════════════════════════════════════════════════════
// Env Groups (with nested vars)
// ═══════════════════════════════════════════════════════════

var envGroupFields = []string{"name", "description"}

func registerEnvGroupsCRUD(r *router.RouterGroup[*core.RequestEvent]) {
	eg := r.Group("/env-groups")
	eg.Bind(apis.RequireSuperuserAuth())

	// List — include vars count
	eg.GET("", func(e *core.RequestEvent) error {
		records, err := e.App.FindAllRecords("env_groups")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "failed to list env groups", err)
		}

		result := make([]map[string]any, 0, len(records))
		for _, r := range records {
			m := recordToMap(r)
			varsCount, _ := e.App.CountRecords("env_group_vars", dbx.HashExp{"group": r.Id})
			m["vars_count"] = varsCount
			result = append(result, m)
		}
		return e.JSON(http.StatusOK, result)
	})

	// Get — include all vars
	eg.GET("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("env_groups", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}

		m := recordToMap(record)
		vars, _ := e.App.FindAllRecords("env_group_vars", dbx.HashExp{"group": record.Id})
		varsList := make([]map[string]any, 0, len(vars))
		for _, v := range vars {
			varsList = append(varsList, recordToMap(v))
		}
		m["vars"] = varsList
		return e.JSON(http.StatusOK, m)
	})

	// Create with optional vars
	eg.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId("env_groups")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}

		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Vars        []struct {
				Key      string `json:"key"`
				Value    string `json:"value"`
				IsSecret bool   `json:"is_secret"`
				Secret   string `json:"secret"`
			} `json:"vars"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request body", err)
		}

		record := core.NewRecord(col)
		record.Set("name", body.Name)
		record.Set("description", body.Description)

		if err := e.App.Save(record); err != nil {
			return e.BadRequestError("Validation failed", err)
		}

		// Create vars
		if err := saveEnvGroupVars(e, record.Id, body.Vars); err != nil {
			return e.BadRequestError("Failed to save vars", err)
		}

		m := recordToMap(record)
		return e.JSON(http.StatusOK, m)
	})

	// Update — replace all vars
	eg.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("env_groups", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}

		var body struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Vars        []struct {
				Key      string `json:"key"`
				Value    string `json:"value"`
				IsSecret bool   `json:"is_secret"`
				Secret   string `json:"secret"`
			} `json:"vars"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request body", err)
		}

		record.Set("name", body.Name)
		record.Set("description", body.Description)

		if err := e.App.Save(record); err != nil {
			return e.BadRequestError("Validation failed", err)
		}

		// Delete existing vars and re-create
		existingVars, _ := e.App.FindAllRecords("env_group_vars", dbx.HashExp{"group": record.Id})
		for _, v := range existingVars {
			_ = e.App.Delete(v)
		}

		if err := saveEnvGroupVars(e, record.Id, body.Vars); err != nil {
			return e.BadRequestError("Failed to save vars", err)
		}

		m := recordToMap(record)
		return e.JSON(http.StatusOK, m)
	})

	// Delete — cascade delete all vars
	eg.DELETE("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("env_groups", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}

		// Delete vars first
		vars, _ := e.App.FindAllRecords("env_group_vars", dbx.HashExp{"group": record.Id})
		for _, v := range vars {
			_ = e.App.Delete(v)
		}

		if err := e.App.Delete(record); err != nil {
			return resourceError(e, http.StatusInternalServerError, "failed to delete env group", err)
		}
		return e.NoContent(http.StatusNoContent)
	})
}

type envGroupVarInput struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	IsSecret bool   `json:"is_secret"`
	Secret   string `json:"secret"`
}

func saveEnvGroupVars(e *core.RequestEvent, groupId string, vars []struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	IsSecret bool   `json:"is_secret"`
	Secret   string `json:"secret"`
}) error {
	if len(vars) == 0 {
		return nil
	}
	col, err := e.App.FindCollectionByNameOrId("env_group_vars")
	if err != nil {
		return err
	}
	for _, v := range vars {
		rec := core.NewRecord(col)
		rec.Set("group", groupId)
		rec.Set("key", v.Key)
		rec.Set("value", v.Value)
		rec.Set("is_secret", v.IsSecret)
		rec.Set("secret", v.Secret)
		if err := e.App.Save(rec); err != nil {
			return err
		}
	}
	return nil
}

// ═══════════════════════════════════════════════════════════
// Databases
// ═══════════════════════════════════════════════════════════

var databaseFields = []string{"name", "type", "host", "port", "db_name", "user", "password", "description"}

func registerDatabasesCRUD(r *router.RouterGroup[*core.RequestEvent]) {
	d := r.Group("/databases")
	d.Bind(apis.RequireSuperuserAuth())

	d.GET("", func(e *core.RequestEvent) error {
		return listRecords(e, "databases")
	})
	d.GET("/{id}", func(e *core.RequestEvent) error {
		return getRecord(e, "databases")
	})
	d.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId("databases")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}
		record := core.NewRecord(col)
		return bindAndSave(e, record, databaseFields)
	})
	d.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("databases", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		return bindAndSave(e, record, databaseFields)
	})
	d.DELETE("/{id}", func(e *core.RequestEvent) error {
		return deleteRecord(e, "databases")
	})
}

// ═══════════════════════════════════════════════════════════
// Cloud Accounts
// ═══════════════════════════════════════════════════════════

var cloudAccountFields = []string{"name", "provider", "access_key_id", "secret", "region", "extra", "description"}

func registerCloudAccountsCRUD(r *router.RouterGroup[*core.RequestEvent]) {
	ca := r.Group("/cloud-accounts")
	ca.Bind(apis.RequireSuperuserAuth())

	ca.GET("", func(e *core.RequestEvent) error {
		return listRecords(e, "cloud_accounts")
	})
	ca.GET("/{id}", func(e *core.RequestEvent) error {
		return getRecord(e, "cloud_accounts")
	})
	ca.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId("cloud_accounts")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}
		record := core.NewRecord(col)
		return bindAndSave(e, record, cloudAccountFields)
	})
	ca.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("cloud_accounts", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		return bindAndSave(e, record, cloudAccountFields)
	})
	ca.DELETE("/{id}", func(e *core.RequestEvent) error {
		return deleteRecord(e, "cloud_accounts")
	})
}

// ═══════════════════════════════════════════════════════════
// Certificates
// ═══════════════════════════════════════════════════════════

var certificateFields = []string{"name", "domain", "cert_pem", "key", "expires_at", "auto_renew", "description"}

func registerCertificatesCRUD(r *router.RouterGroup[*core.RequestEvent]) {
	c := r.Group("/certificates")
	c.Bind(apis.RequireSuperuserAuth())

	c.GET("", func(e *core.RequestEvent) error {
		return listRecords(e, "certificates")
	})
	c.GET("/{id}", func(e *core.RequestEvent) error {
		return getRecord(e, "certificates")
	})
	c.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId("certificates")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}
		record := core.NewRecord(col)
		return bindAndSave(e, record, certificateFields)
	})
	c.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("certificates", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		return bindAndSave(e, record, certificateFields)
	})
	c.DELETE("/{id}", func(e *core.RequestEvent) error {
		return deleteRecord(e, "certificates")
	})
}

// ═══════════════════════════════════════════════════════════
// Integrations
// ═══════════════════════════════════════════════════════════

var integrationFields = []string{"name", "type", "url", "auth_type", "credential", "extra", "description"}

func registerIntegrationsCRUD(r *router.RouterGroup[*core.RequestEvent]) {
	ig := r.Group("/integrations")
	ig.Bind(apis.RequireSuperuserAuth())

	ig.GET("", func(e *core.RequestEvent) error {
		return listRecords(e, "integrations")
	})
	ig.GET("/{id}", func(e *core.RequestEvent) error {
		return getRecord(e, "integrations")
	})
	ig.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId("integrations")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}
		record := core.NewRecord(col)
		return bindAndSave(e, record, integrationFields)
	})
	ig.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("integrations", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		return bindAndSave(e, record, integrationFields)
	})
	ig.DELETE("/{id}", func(e *core.RequestEvent) error {
		return deleteRecord(e, "integrations")
	})
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
