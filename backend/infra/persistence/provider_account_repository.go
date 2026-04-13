package persistence

import (
	"database/sql"
	"errors"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	domainaccounts "github.com/websoft9/appos/backend/domain/resource/accounts"
	"github.com/websoft9/appos/backend/infra/collections"
)

type pocketBaseProviderAccountRepository struct {
	app core.App
}

func NewProviderAccountRepository(app core.App) domainaccounts.Repository {
	return &pocketBaseProviderAccountRepository{app: app}
}

func (r *pocketBaseProviderAccountRepository) List() ([]*domainaccounts.ProviderAccount, error) {
	records, err := r.app.FindAllRecords(collections.ProviderAccounts)
	if err != nil {
		return nil, err
	}

	items := make([]*domainaccounts.ProviderAccount, 0, len(records))
	for _, record := range records {
		items = append(items, providerAccountFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseProviderAccountRepository) Get(id string) (*domainaccounts.ProviderAccount, error) {
	record, err := r.app.FindRecordById(collections.ProviderAccounts, id)
	if err != nil {
		return nil, wrapProviderAccountLookupError(id, err)
	}
	return providerAccountFromRecord(record), nil
}

func (r *pocketBaseProviderAccountRepository) New() (*domainaccounts.ProviderAccount, error) {
	return domainaccounts.NewProviderAccount(), nil
}

func (r *pocketBaseProviderAccountRepository) ExistsByName(name string, excludeID string) (bool, error) {
	filter := "name = {:name}"
	params := map[string]any{"name": strings.TrimSpace(name)}
	if strings.TrimSpace(excludeID) != "" {
		filter += " && id != {:excludeId}"
		params["excludeId"] = strings.TrimSpace(excludeID)
	}
	records, err := r.app.FindRecordsByFilter(collections.ProviderAccounts, filter, "", 1, 0, params)
	if err != nil {
		return false, err
	}
	return len(records) > 0, nil
}

func (r *pocketBaseProviderAccountRepository) HasReferences(accountID string) (bool, error) {
	trimmedID := strings.TrimSpace(accountID)
	if trimmedID == "" {
		return false, nil
	}
	for _, collectionName := range []string{collections.Instances, collections.AIProviders} {
		records, err := r.app.FindRecordsByFilter(collectionName, "provider_account = {:accountId}", "", 1, 0, map[string]any{"accountId": trimmedID})
		if err != nil {
			return false, err
		}
		if len(records) > 0 {
			return true, nil
		}
	}
	records, err := r.app.FindRecordsByFilter(collections.Connectors, "provider_account = {:accountId} && kind != {:kind}", "", 1, 0, map[string]any{"accountId": trimmedID, "kind": "llm"})
	if err != nil {
		return false, err
	}
	if len(records) > 0 {
		return true, nil
	}
	return false, nil
}

func (r *pocketBaseProviderAccountRepository) Save(account *domainaccounts.ProviderAccount) error {
	record, err := r.recordForSave(account)
	if err != nil {
		return err
	}
	if err := r.app.Save(record); err != nil {
		return wrapProviderAccountSaveError(account, err)
	}
	copyProviderAccountState(account, providerAccountFromRecord(record))
	return nil
}

func (r *pocketBaseProviderAccountRepository) Delete(account *domainaccounts.ProviderAccount) error {
	record, err := r.app.FindRecordById(collections.ProviderAccounts, account.ID())
	if err != nil {
		return wrapProviderAccountLookupError(account.ID(), err)
	}
	return r.app.Delete(record)
}

func (r *pocketBaseProviderAccountRepository) RunInTransaction(run func(domainaccounts.Repository) error) error {
	return r.app.RunInTransaction(func(txApp core.App) error {
		return run(NewProviderAccountRepository(txApp))
	})
}

func (r *pocketBaseProviderAccountRepository) recordForSave(account *domainaccounts.ProviderAccount) (*core.Record, error) {
	if account.ID() != "" {
		record, err := r.app.FindRecordById(collections.ProviderAccounts, account.ID())
		if err != nil {
			return nil, wrapProviderAccountLookupError(account.ID(), err)
		}
		applyProviderAccountToRecord(record, account)
		return record, nil
	}

	collection, err := r.app.FindCollectionByNameOrId(collections.ProviderAccounts)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	applyProviderAccountToRecord(record, account)
	return record, nil
}

func providerAccountFromRecord(record *core.Record) *domainaccounts.ProviderAccount {
	return domainaccounts.RestoreProviderAccount(domainaccounts.Snapshot{
		ID:           record.Id,
		Created:      record.GetString("created"),
		Updated:      record.GetString("updated"),
		Name:         record.GetString("name"),
		Kind:         record.GetString("kind"),
		TemplateID:   record.GetString("template_id"),
		Identifier:   record.GetString("identifier"),
		CredentialID: record.GetString("credential"),
		Config:       domainaccounts.DecodeConfig(record.Get("config")),
		Description:  record.GetString("description"),
	})
}

func applyProviderAccountToRecord(record *core.Record, account *domainaccounts.ProviderAccount) {
	snapshot := account.Snapshot()
	record.Set("name", snapshot.Name)
	record.Set("kind", snapshot.Kind)
	record.Set("template_id", snapshot.TemplateID)
	record.Set("identifier", snapshot.Identifier)
	record.Set("credential", snapshot.CredentialID)
	record.Set("config", snapshot.Config)
	record.Set("description", snapshot.Description)
}

func copyProviderAccountState(dst *domainaccounts.ProviderAccount, src *domainaccounts.ProviderAccount) {
	tmp := domainaccounts.RestoreProviderAccount(src.Snapshot())
	*dst = *tmp
}

func wrapProviderAccountLookupError(id string, err error) error {
	if isPocketBaseNotFoundForProviderAccount(err) {
		return &domainaccounts.NotFoundError{ID: id, Cause: err}
	}
	return err
}

func wrapProviderAccountSaveError(account *domainaccounts.ProviderAccount, err error) error {
	if isProviderAccountNameConflict(err) {
		return &domainaccounts.ConflictError{Message: "provider account name already exists", Cause: err}
	}
	return err
}

func isPocketBaseNotFoundForProviderAccount(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, sql.ErrNoRows) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "not found") || strings.Contains(message, "no rows")
}

func isProviderAccountNameConflict(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "idx_provider_accounts_name") {
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
