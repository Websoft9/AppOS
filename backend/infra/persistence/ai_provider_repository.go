package persistence

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	domainaiproviders "github.com/websoft9/appos/backend/domain/resource/aiproviders"
	"github.com/websoft9/appos/backend/infra/collections"
)

type pocketBaseAIProviderRepository struct {
	app core.App
}

func NewAIProviderRepository(app core.App) domainaiproviders.Repository {
	return &pocketBaseAIProviderRepository{app: app}
}

func (r *pocketBaseAIProviderRepository) List() ([]*domainaiproviders.AIProvider, error) {
	records, err := r.app.FindAllRecords(collections.AIProviders)
	if err != nil {
		return nil, err
	}

	items := make([]*domainaiproviders.AIProvider, 0, len(records))
	for _, record := range records {
		items = append(items, aiProviderFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseAIProviderRepository) Get(id string) (*domainaiproviders.AIProvider, error) {
	record, err := r.app.FindRecordById(collections.AIProviders, id)
	if err != nil {
		return nil, wrapAIProviderLookupError(id, err)
	}
	return aiProviderFromRecord(record), nil
}

func (r *pocketBaseAIProviderRepository) New() (*domainaiproviders.AIProvider, error) {
	return domainaiproviders.NewAIProvider(), nil
}

func (r *pocketBaseAIProviderRepository) ExistsByName(name string, excludeID string) (bool, error) {
	filter := "name = {:name}"
	params := map[string]any{"name": strings.TrimSpace(name)}
	if strings.TrimSpace(excludeID) != "" {
		filter += " && id != {:excludeId}"
		params["excludeId"] = strings.TrimSpace(excludeID)
	}
	records, err := r.app.FindRecordsByFilter(collections.AIProviders, filter, "", 1, 0, params)
	if err != nil {
		return false, err
	}
	return len(records) > 0, nil
}

func (r *pocketBaseAIProviderRepository) Save(provider *domainaiproviders.AIProvider) error {
	record, err := r.recordForSave(provider)
	if err != nil {
		return err
	}
	if err := r.app.Save(record); err != nil {
		return wrapAIProviderSaveError(provider, err)
	}
	copyAIProviderState(provider, aiProviderFromRecord(record))
	return nil
}

func (r *pocketBaseAIProviderRepository) Delete(provider *domainaiproviders.AIProvider) error {
	record, err := r.app.FindRecordById(collections.AIProviders, provider.ID())
	if err != nil {
		return wrapAIProviderLookupError(provider.ID(), err)
	}
	return r.app.Delete(record)
}

func (r *pocketBaseAIProviderRepository) ListByKind(kind string) ([]*domainaiproviders.AIProvider, error) {
	records, err := r.app.FindRecordsByFilter(collections.AIProviders, "kind = {:kind}", "", 0, 0, map[string]any{"kind": kind})
	if err != nil {
		return nil, err
	}

	items := make([]*domainaiproviders.AIProvider, 0, len(records))
	for _, record := range records {
		items = append(items, aiProviderFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseAIProviderRepository) ClearDefaultsByKind(kind string, excludeID string) error {
	kind = strings.TrimSpace(kind)
	if kind == "" {
		return nil
	}
	query := "UPDATE " + collections.AIProviders + " SET is_default = false WHERE kind = {:kind} AND is_default = true"
	params := map[string]any{"kind": kind}
	if strings.TrimSpace(excludeID) != "" {
		query += " AND id != {:excludeId}"
		params["excludeId"] = excludeID
	}
	_, err := r.app.DB().NewQuery(query).Bind(params).Execute()
	return err
}

func (r *pocketBaseAIProviderRepository) RunInTransaction(run func(domainaiproviders.Repository) error) error {
	return r.app.RunInTransaction(func(txApp core.App) error {
		return run(NewAIProviderRepository(txApp))
	})
}

func (r *pocketBaseAIProviderRepository) recordForSave(provider *domainaiproviders.AIProvider) (*core.Record, error) {
	if provider.ID() != "" {
		record, err := r.app.FindRecordById(collections.AIProviders, provider.ID())
		if err != nil {
			return nil, wrapAIProviderLookupError(provider.ID(), err)
		}
		applyAIProviderToRecord(record, provider)
		return record, nil
	}

	collection, err := r.app.FindCollectionByNameOrId(collections.AIProviders)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	applyAIProviderToRecord(record, provider)
	return record, nil
}

func aiProviderFromRecord(record *core.Record) *domainaiproviders.AIProvider {
	return domainaiproviders.RestoreAIProvider(domainaiproviders.Snapshot{
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
		Config:            domainaiproviders.DecodeConfig(record.Get("config")),
		Description:       record.GetString("description"),
	})
}

func applyAIProviderToRecord(record *core.Record, provider *domainaiproviders.AIProvider) {
	snapshot := provider.Snapshot()
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

func copyAIProviderState(dst *domainaiproviders.AIProvider, src *domainaiproviders.AIProvider) {
	tmp := domainaiproviders.RestoreAIProvider(src.Snapshot())
	*dst = *tmp
}

func wrapAIProviderLookupError(id string, err error) error {
	if isPocketBaseNotFoundForAIProvider(err) {
		return &domainaiproviders.NotFoundError{ID: id, Cause: err}
	}
	return err
}

func wrapAIProviderSaveError(provider *domainaiproviders.AIProvider, err error) error {
	if isAIProviderNameConflict(err) {
		return &domainaiproviders.ConflictError{Message: "AI provider name already exists", Cause: err}
	}
	return err
}

func isPocketBaseNotFoundForAIProvider(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sql.ErrNoRows) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "not found") || strings.Contains(message, "no rows")
}

func isAIProviderNameConflict(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "idx_ai_providers_name") {
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
