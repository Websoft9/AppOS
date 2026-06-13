package proxy

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/resource/connectors"
	"github.com/websoft9/appos/backend/infra/collections"
)

type appConnectorRepository struct {
	app core.App
}

func newConnectorRepository(app core.App) connectors.Repository {
	return &appConnectorRepository{app: app}
}

func (r *appConnectorRepository) List() ([]*connectors.Connector, error) {
	records, err := r.app.FindAllRecords(collections.Connectors)
	if err != nil {
		return nil, err
	}
	items := make([]*connectors.Connector, 0, len(records))
	for _, record := range records {
		items = append(items, connectorFromRecord(record))
	}
	return items, nil
}

func (r *appConnectorRepository) Get(id string) (*connectors.Connector, error) {
	record, err := r.app.FindRecordById(collections.Connectors, id)
	if err != nil {
		return nil, wrapConnectorLookupError(id, err)
	}
	return connectorFromRecord(record), nil
}

func (r *appConnectorRepository) New() (*connectors.Connector, error) {
	return connectors.NewConnector(), nil
}

func (r *appConnectorRepository) ExistsByName(name string, excludeID string) (bool, error) {
	filter := "name = {:name}"
	params := map[string]any{"name": strings.TrimSpace(name)}
	if strings.TrimSpace(excludeID) != "" {
		filter += " && id != {:excludeId}"
		params["excludeId"] = strings.TrimSpace(excludeID)
	}
	records, err := r.app.FindRecordsByFilter(collections.Connectors, filter, "", 1, 0, params)
	if err != nil {
		return false, err
	}
	return len(records) > 0, nil
}

func (r *appConnectorRepository) Save(connector *connectors.Connector) error {
	record, err := r.recordForSave(connector)
	if err != nil {
		return err
	}
	if err := r.app.Save(record); err != nil {
		return wrapConnectorSaveError(connector, err)
	}
	copyConnectorState(connector, connectorFromRecord(record))
	return nil
}

func (r *appConnectorRepository) Delete(connector *connectors.Connector) error {
	record, err := r.app.FindRecordById(collections.Connectors, connector.ID())
	if err != nil {
		return wrapConnectorLookupError(connector.ID(), err)
	}
	return r.app.Delete(record)
}

func (r *appConnectorRepository) ListByKind(kind string) ([]*connectors.Connector, error) {
	records, err := r.app.FindRecordsByFilter(collections.Connectors, "kind = {:kind}", "", 0, 0, map[string]any{"kind": kind})
	if err != nil {
		return nil, err
	}
	items := make([]*connectors.Connector, 0, len(records))
	for _, record := range records {
		items = append(items, connectorFromRecord(record))
	}
	return items, nil
}

func (r *appConnectorRepository) ClearDefaultsByKind(kind string, excludeID string) error {
	kind = strings.TrimSpace(kind)
	if kind == "" {
		return nil
	}
	query := "UPDATE " + collections.Connectors + " SET is_default = false WHERE kind = {:kind} AND is_default = true"
	params := map[string]any{"kind": kind}
	if strings.TrimSpace(excludeID) != "" {
		query += " AND id != {:excludeId}"
		params["excludeId"] = excludeID
	}
	_, err := r.app.DB().NewQuery(query).Bind(params).Execute()
	return err
}

func (r *appConnectorRepository) RunInTransaction(run func(connectors.Repository) error) error {
	return r.app.RunInTransaction(func(txApp core.App) error {
		return run(newConnectorRepository(txApp))
	})
}

func (r *appConnectorRepository) recordForSave(connector *connectors.Connector) (*core.Record, error) {
	if connector.ID() != "" {
		record, err := r.app.FindRecordById(collections.Connectors, connector.ID())
		if err != nil {
			return nil, wrapConnectorLookupError(connector.ID(), err)
		}
		applyConnectorToRecord(record, connector)
		return record, nil
	}
	collection, err := r.app.FindCollectionByNameOrId(collections.Connectors)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	applyConnectorToRecord(record, connector)
	return record, nil
}

func connectorFromRecord(record *core.Record) *connectors.Connector {
	return connectors.RestoreConnector(connectors.Snapshot{
		ID:                record.Id,
		Created:           record.GetString("created"),
		Updated:           record.GetString("updated"),
		Name:              record.GetString("name"),
		Kind:              record.GetString("kind"),
		IsDefault:         record.GetBool("is_default"),
		TemplateID:        record.GetString("template_id"),
		Endpoint:          record.GetString("endpoint"),
		AuthScheme:        record.GetString("auth_scheme"),
		ProviderAccountID: record.GetString("provider_account"),
		CredentialID:      record.GetString("credential"),
		Config:            connectors.DecodeConfig(record.Get("config")),
		Description:       record.GetString("description"),
	})
}

func applyConnectorToRecord(record *core.Record, connector *connectors.Connector) {
	snapshot := connector.Snapshot()
	record.Set("name", snapshot.Name)
	record.Set("kind", snapshot.Kind)
	record.Set("is_default", snapshot.IsDefault)
	record.Set("template_id", snapshot.TemplateID)
	record.Set("endpoint", snapshot.Endpoint)
	record.Set("auth_scheme", snapshot.AuthScheme)
	record.Set("provider_account", snapshot.ProviderAccountID)
	record.Set("credential", snapshot.CredentialID)
	record.Set("config", snapshot.Config)
	record.Set("description", snapshot.Description)
}

func copyConnectorState(dst *connectors.Connector, src *connectors.Connector) {
	tmp := connectors.RestoreConnector(src.Snapshot())
	*dst = *tmp
}

func wrapConnectorLookupError(id string, err error) error {
	if isPocketBaseNotFound(err) {
		return &connectors.NotFoundError{ID: id, Cause: err}
	}
	return err
}

func wrapConnectorSaveError(connector *connectors.Connector, err error) error {
	if isConnectorNameConflict(err) {
		return &connectors.ConflictError{Message: "connector name already exists", Cause: err}
	}
	return err
}

func isConnectorNameConflict(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "idx_connectors_name") {
		return true
	}
	if strings.Contains(message, "unique") && strings.Contains(message, "name") {
		return true
	}
	if strings.Contains(message, "duplicate") && strings.Contains(message, "name") {
		return true
	}
	return false
}

func isPocketBaseNotFound(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sql.ErrNoRows) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "not found") || strings.Contains(message, "no rows")
}