package routes

import (
	"fmt"
	"net"
	"net/http"
	"time"

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
//	/api/ext/resources/groups/*
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

	registerResourceGroupsCRUD(r)
	registerServersCRUD(r)
	registerSecretsCRUD(r)
	registerEnvGroupsCRUD(r)
	registerDatabasesCRUD(r)
	registerCloudAccountsCRUD(r)
	registerCertificatesCRUD(r)
	registerIntegrationsCRUD(r)
	registerScriptsCRUD(r)
}

// allResourceTypes maps URL-segment → collection name for cross-type operations.
var allResourceTypes = map[string]string{
	"servers":        "servers",
	"secrets":        "secrets",
	"env-groups":     "env_groups",
	"databases":      "databases",
	"cloud-accounts": "cloud_accounts",
	"certificates":   "certificates",
	"integrations":   "integrations",
	"scripts":        "scripts",
}

// resourceTypeLabel is the ordered list for stable cross-type listing.
var resourceTypeOrder = []string{
	"servers", "secrets", "env-groups", "databases",
	"cloud-accounts", "certificates", "integrations", "scripts",
}

// ═══════════════════════════════════════════════════════════
// Resource Groups
// ═══════════════════════════════════════════════════════════

var groupFields = []string{"name", "description"}

func registerResourceGroupsCRUD(r *router.RouterGroup[*core.RequestEvent]) {
	g := r.Group("/groups")
	g.Bind(apis.RequireSuperuserAuth())

	// List — with per-group resource count
	g.GET("", func(e *core.RequestEvent) error {
		groups, err := e.App.FindAllRecords("resource_groups")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "failed to list groups", err)
		}

		result := make([]map[string]any, 0, len(groups))
		for _, grp := range groups {
			m := recordToMap(grp)
			count := 0
			for _, colName := range allResourceTypes {
				n, _ := e.App.CountRecords(colName,
					dbx.NewExp("groups LIKE {:pattern}", dbx.Params{"pattern": "%\"" + grp.Id + "\"%"}))
				count += int(n)
			}
			m["resource_count"] = count
			result = append(result, m)
		}
		return e.JSON(http.StatusOK, result)
	})

	// Create
	g.POST("", func(e *core.RequestEvent) error {
		col, err := e.App.FindCollectionByNameOrId("resource_groups")
		if err != nil {
			return resourceError(e, http.StatusInternalServerError, "collection not found", err)
		}
		record := core.NewRecord(col)
		return bindAndSave(e, record, groupFields)
	})

	// Get detail
	g.GET("/{id}", func(e *core.RequestEvent) error {
		return getRecord(e, "resource_groups")
	})

	// Update
	g.PUT("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("resource_groups", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		return bindAndSave(e, record, groupFields)
	})

	// Delete — blocked for default group
	g.DELETE("/{id}", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		record, err := e.App.FindRecordById("resource_groups", id)
		if err != nil {
			return e.NotFoundError("Record not found", err)
		}
		if record.GetBool("is_default") {
			return resourceError(e, http.StatusBadRequest, "cannot delete the default group", nil)
		}
		if err := e.App.Delete(record); err != nil {
			return resourceError(e, http.StatusInternalServerError, "failed to delete group", err)
		}
		return e.NoContent(http.StatusNoContent)
	})

	// Cross-type resource list for a group
	g.GET("/{id}/resources", func(e *core.RequestEvent) error {
		groupId := e.Request.PathValue("id")
		if _, err := e.App.FindRecordById("resource_groups", groupId); err != nil {
			return e.NotFoundError("Group not found", err)
		}

		result := make([]map[string]any, 0)
		for _, typeKey := range resourceTypeOrder {
			colName := allResourceTypes[typeKey]
			records, err := e.App.FindAllRecords(colName,
				dbx.NewExp("groups LIKE {:pattern}", dbx.Params{"pattern": "%\"" + groupId + "\"%"}))
			if err != nil {
				continue
			}
			for _, rec := range records {
				m := recordToMap(rec)
				m["type"] = typeKey
				result = append(result, m)
			}
		}
		return e.JSON(http.StatusOK, result)
	})

	// Batch add/remove resources to/from a group
	g.POST("/{id}/resources/batch", func(e *core.RequestEvent) error {
		groupId := e.Request.PathValue("id")
		if _, err := e.App.FindRecordById("resource_groups", groupId); err != nil {
			return e.NotFoundError("Group not found", err)
		}

		var body struct {
			Action string `json:"action"` // "add" | "remove"
			Items  []struct {
				Type string `json:"type"` // "servers", "secrets", etc.
				ID   string `json:"id"`
			} `json:"items"`
		}
		if err := e.BindBody(&body); err != nil {
			return e.BadRequestError("Invalid request body", err)
		}
		if body.Action != "add" && body.Action != "remove" {
			return e.BadRequestError("action must be 'add' or 'remove'", nil)
		}

		for _, item := range body.Items {
			colName, ok := allResourceTypes[item.Type]
			if !ok {
				continue // skip unknown types
			}
			rec, err := e.App.FindRecordById(colName, item.ID)
			if err != nil {
				continue // skip missing records
			}

			// Get current groups as []string
			current := rec.GetStringSlice("groups")
			updated := toggleGroupMembership(current, groupId, body.Action == "add")
			rec.Set("groups", updated)
			_ = e.App.Save(rec)
		}

		return e.JSON(http.StatusOK, map[string]any{"ok": true})
	})
}

// toggleGroupMembership adds or removes groupId from the list.
func toggleGroupMembership(current []string, groupId string, add bool) []string {
	if add {
		for _, id := range current {
			if id == groupId {
				return current // already present
			}
		}
		return append(current, groupId)
	}
	// remove
	result := make([]string, 0, len(current))
	for _, id := range current {
		if id != groupId {
			result = append(result, id)
		}
	}
	return result
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

var serverFields = []string{"name", "host", "port", "user", "auth_type", "credential", "description", "groups", "connect_type"}

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

	// Ping — test whether the server is reachable.
	// Tunnel servers: check in-memory session registry.
	// Direct servers: attempt a TCP dial to host:port.
	s.GET("/{id}/ping", func(e *core.RequestEvent) error {
		id := e.Request.PathValue("id")
		server, err := e.App.FindRecordById("servers", id)
		if err != nil {
			return e.NotFoundError("server not found", err)
		}

		if server.GetString("connect_type") == "tunnel" {
			// Delegate to tunnel registry.
			if tunnelSessions != nil {
				if _, ok := tunnelSessions.Get(id); ok {
					return e.JSON(http.StatusOK, map[string]any{"status": "online"})
				}
			}
			return e.JSON(http.StatusOK, map[string]any{"status": "offline"})
		}

		// Direct server: TCP dial.
		host := server.GetString("host")
		port := server.GetInt("port")
		if port == 0 {
			port = 22
		}
		addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))
		start := time.Now()
		conn, err := net.DialTimeout("tcp", addr, 5*time.Second)
		if err != nil {
			return e.JSON(http.StatusOK, map[string]any{"status": "offline"})
		}
		_ = conn.Close()
		return e.JSON(http.StatusOK, map[string]any{
			"status":     "online",
			"latency_ms": time.Since(start).Milliseconds(),
		})
	})
}

// ═══════════════════════════════════════════════════════════
// Secrets (value encrypted at rest)
// ═══════════════════════════════════════════════════════════

var secretFields = []string{"name", "type", "description", "groups"}

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

var envGroupFields = []string{"name", "description", "groups"}

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
			Name        string   `json:"name"`
			Description string   `json:"description"`
			Groups      []string `json:"groups"`
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
		if len(body.Groups) > 0 {
			record.Set("groups", body.Groups)
		}

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
			Name        string   `json:"name"`
			Description string   `json:"description"`
			Groups      []string `json:"groups"`
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
		if len(body.Groups) > 0 {
			record.Set("groups", body.Groups)
		}

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

var databaseFields = []string{"name", "type", "host", "port", "db_name", "user", "password", "description", "groups"}

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

var cloudAccountFields = []string{"name", "provider", "access_key_id", "secret", "region", "extra", "description", "groups"}

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

var certificateFields = []string{"name", "domain", "cert_pem", "key", "expires_at", "auto_renew", "description", "groups"}

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

var integrationFields = []string{"name", "type", "url", "auth_type", "credential", "extra", "description", "groups"}

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

var scriptFields = []string{"name", "language", "code", "description", "groups"}

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
