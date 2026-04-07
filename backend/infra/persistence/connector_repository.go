package persistence

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	domainconnectors "github.com/websoft9/appos/backend/domain/resource/connectors"
)

type pocketBaseConnectorRepository struct {
	app core.App
}

func NewConnectorRepository(app core.App) domainconnectors.Repository {
	return &pocketBaseConnectorRepository{app: app}
}

func (r *pocketBaseConnectorRepository) List() ([]*domainconnectors.Connector, error) {
	records, err := r.app.FindAllRecords(domainconnectors.Collection)
	if err != nil {
		return nil, err
	}

	items := make([]*domainconnectors.Connector, 0, len(records))
	for _, record := range records {
		items = append(items, connectorFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseConnectorRepository) Get(id string) (*domainconnectors.Connector, error) {
	record, err := r.app.FindRecordById(domainconnectors.Collection, id)
	if err != nil {
		return nil, wrapConnectorLookupError(id, err)
	}
	return connectorFromRecord(record), nil
}

func (r *pocketBaseConnectorRepository) New() (*domainconnectors.Connector, error) {
	return domainconnectors.NewConnector(), nil
}

func (r *pocketBaseConnectorRepository) Save(connector *domainconnectors.Connector) error {
	record, err := r.recordForSave(connector)
	if err != nil {
		return err
	}
	if err := r.app.Save(record); err != nil {
		return err
	}
	copyConnectorState(connector, connectorFromRecord(record))
	return nil
}

func (r *pocketBaseConnectorRepository) Delete(connector *domainconnectors.Connector) error {
	record, err := r.app.FindRecordById(domainconnectors.Collection, connector.ID())
	if err != nil {
		return wrapConnectorLookupError(connector.ID(), err)
	}
	return r.app.Delete(record)
}

func (r *pocketBaseConnectorRepository) ListByKind(kind string) ([]*domainconnectors.Connector, error) {
	records, err := r.app.FindRecordsByFilter(domainconnectors.Collection, "kind = {:kind}", "", 0, 0, map[string]any{"kind": kind})
	if err != nil {
		return nil, err
	}

	items := make([]*domainconnectors.Connector, 0, len(records))
	for _, record := range records {
		items = append(items, connectorFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseConnectorRepository) ClearDefaultsByKind(kind string, excludeID string) error {
	kind = strings.TrimSpace(kind)
	if kind == "" {
		return nil
	}
	query := "UPDATE " + domainconnectors.Collection + " SET is_default = false WHERE kind = {:kind} AND is_default = true"
	params := map[string]any{"kind": kind}
	if strings.TrimSpace(excludeID) != "" {
		query += " AND id != {:excludeId}"
		params["excludeId"] = excludeID
	}
	_, err := r.app.DB().NewQuery(query).Bind(params).Execute()
	return err
}

func (r *pocketBaseConnectorRepository) RunInTransaction(run func(domainconnectors.Repository) error) error {
	return r.app.RunInTransaction(func(txApp core.App) error {
		return run(NewConnectorRepository(txApp))
	})
}

func (r *pocketBaseConnectorRepository) recordForSave(connector *domainconnectors.Connector) (*core.Record, error) {
	if connector.ID() != "" {
		record, err := r.app.FindRecordById(domainconnectors.Collection, connector.ID())
		if err != nil {
			return nil, wrapConnectorLookupError(connector.ID(), err)
		}
		applyConnectorToRecord(record, connector)
		return record, nil
	}

	collection, err := r.app.FindCollectionByNameOrId(domainconnectors.Collection)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	applyConnectorToRecord(record, connector)
	return record, nil
}

func connectorFromRecord(record *core.Record) *domainconnectors.Connector {
	return domainconnectors.RestoreConnector(domainconnectors.Snapshot{
		ID:           record.Id,
		Created:      record.GetString("created"),
		Updated:      record.GetString("updated"),
		Name:         record.GetString("name"),
		Kind:         record.GetString("kind"),
		IsDefault:    record.GetBool("is_default"),
		TemplateID:   record.GetString("template_id"),
		Endpoint:     record.GetString("endpoint"),
		AuthScheme:   record.GetString("auth_scheme"),
		CredentialID: record.GetString("credential"),
		Config:       domainconnectors.DecodeConfig(record.Get("config")),
		Description:  record.GetString("description"),
	})
}

func applyConnectorToRecord(record *core.Record, connector *domainconnectors.Connector) {
	snapshot := connector.Snapshot()
	record.Set("name", snapshot.Name)
	record.Set("kind", snapshot.Kind)
	record.Set("is_default", snapshot.IsDefault)
	record.Set("template_id", snapshot.TemplateID)
	record.Set("endpoint", snapshot.Endpoint)
	record.Set("auth_scheme", snapshot.AuthScheme)
	record.Set("credential", snapshot.CredentialID)
	record.Set("config", snapshot.Config)
	record.Set("description", snapshot.Description)
}

func copyConnectorState(dst *domainconnectors.Connector, src *domainconnectors.Connector) {
	tmp := domainconnectors.RestoreConnector(src.Snapshot())
	*dst = *tmp
}

func wrapConnectorLookupError(id string, err error) error {
	if isPocketBaseNotFound(err) {
		return &domainconnectors.NotFoundError{ID: id, Cause: err}
	}
	return err
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
