package accounts

type Repository interface {
	List() ([]*ProviderAccount, error)
	Get(id string) (*ProviderAccount, error)
	New() (*ProviderAccount, error)
	ExistsByName(name string, excludeID string) (bool, error)
	HasReferences(accountID string) (bool, error)
	Save(account *ProviderAccount) error
	Delete(account *ProviderAccount) error
	RunInTransaction(func(Repository) error) error
}
