package persistence

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	domaininstances "github.com/websoft9/appos/backend/domain/resource/instances"
	"github.com/websoft9/appos/backend/infra/collections"
)

type pocketBaseInstanceRepository struct {
	app core.App
}

func NewInstanceRepository(app core.App) domaininstances.Repository {
	return &pocketBaseInstanceRepository{app: app}
}

func (r *pocketBaseInstanceRepository) List() ([]*domaininstances.Instance, error) {
	records, err := r.app.FindAllRecords(collections.Instances)
	if err != nil {
		return nil, err
	}

	items := make([]*domaininstances.Instance, 0, len(records))
	for _, record := range records {
		items = append(items, instanceFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseInstanceRepository) Get(id string) (*domaininstances.Instance, error) {
	record, err := r.app.FindRecordById(collections.Instances, id)
	if err != nil {
		return nil, wrapInstanceLookupError(id, err)
	}
	return instanceFromRecord(record), nil
}

func (r *pocketBaseInstanceRepository) New() (*domaininstances.Instance, error) {
	return domaininstances.NewInstance(), nil
}

func (r *pocketBaseInstanceRepository) ExistsByName(name string, excludeID string) (bool, error) {
	filter := "name = {:name}"
	params := map[string]any{"name": strings.TrimSpace(name)}
	if strings.TrimSpace(excludeID) != "" {
		filter += " && id != {:excludeId}"
		params["excludeId"] = strings.TrimSpace(excludeID)
	}
	records, err := r.app.FindRecordsByFilter(collections.Instances, filter, "", 1, 0, params)
	if err != nil {
		return false, err
	}
	return len(records) > 0, nil
}

func (r *pocketBaseInstanceRepository) Save(instance *domaininstances.Instance) error {
	record, err := r.recordForSave(instance)
	if err != nil {
		return err
	}
	if err := r.app.Save(record); err != nil {
		return wrapInstanceSaveError(instance, err)
	}
	copyInstanceState(instance, instanceFromRecord(record))
	return nil
}

func (r *pocketBaseInstanceRepository) Delete(instance *domaininstances.Instance) error {
	record, err := r.app.FindRecordById(collections.Instances, instance.ID())
	if err != nil {
		return wrapInstanceLookupError(instance.ID(), err)
	}
	return r.app.Delete(record)
}

func (r *pocketBaseInstanceRepository) RunInTransaction(run func(domaininstances.Repository) error) error {
	return r.app.RunInTransaction(func(txApp core.App) error {
		return run(NewInstanceRepository(txApp))
	})
}

func (r *pocketBaseInstanceRepository) recordForSave(instance *domaininstances.Instance) (*core.Record, error) {
	if instance.ID() != "" {
		record, err := r.app.FindRecordById(collections.Instances, instance.ID())
		if err != nil {
			return nil, wrapInstanceLookupError(instance.ID(), err)
		}
		applyInstanceToRecord(record, instance)
		return record, nil
	}

	collection, err := r.app.FindCollectionByNameOrId(collections.Instances)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	applyInstanceToRecord(record, instance)
	return record, nil
}

func instanceFromRecord(record *core.Record) *domaininstances.Instance {
	return domaininstances.RestoreInstance(domaininstances.Snapshot{
		ID:                record.Id,
		Created:           record.GetString("created"),
		Updated:           record.GetString("updated"),
		Name:              record.GetString("name"),
		Kind:              record.GetString("kind"),
		TemplateID:        record.GetString("template_id"),
		Endpoint:          record.GetString("endpoint"),
		ProviderAccountID: record.GetString("provider_account"),
		CredentialID:      record.GetString("credential"),
		Config:            domaininstances.DecodeConfig(record.Get("config")),
		Description:       record.GetString("description"),
	})
}

func applyInstanceToRecord(record *core.Record, instance *domaininstances.Instance) {
	snapshot := instance.Snapshot()
	record.Set("name", snapshot.Name)
	record.Set("kind", snapshot.Kind)
	record.Set("template_id", snapshot.TemplateID)
	record.Set("endpoint", snapshot.Endpoint)
	record.Set("provider_account", snapshot.ProviderAccountID)
	record.Set("credential", snapshot.CredentialID)
	record.Set("config", snapshot.Config)
	record.Set("description", snapshot.Description)
}

func copyInstanceState(dst *domaininstances.Instance, src *domaininstances.Instance) {
	tmp := domaininstances.RestoreInstance(src.Snapshot())
	*dst = *tmp
}

func wrapInstanceLookupError(id string, err error) error {
	if isPocketBaseNotFoundForInstance(err) {
		return &domaininstances.NotFoundError{ID: id, Cause: err}
	}
	return err
}

func wrapInstanceSaveError(instance *domaininstances.Instance, err error) error {
	if isInstanceNameConflict(err) {
		return &domaininstances.ConflictError{Message: "instance name already exists", Cause: err}
	}
	return err
}

func isPocketBaseNotFoundForInstance(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sql.ErrNoRows) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "not found") || strings.Contains(message, "no rows")
}

func isInstanceNameConflict(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "idx_instances_name") {
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
