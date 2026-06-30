package aiproviders

type Repository interface {
	List() ([]*AIProvider, error)
	Get(id string) (*AIProvider, error)
	New() (*AIProvider, error)
	ExistsByName(name string, excludeID string) (bool, error)
	Save(provider *AIProvider) error
	Delete(provider *AIProvider) error
	ListByKind(kind string) ([]*AIProvider, error)
	ClearDefaultsByTemplate(templateID string, excludeID string) error
	RunInTransaction(func(Repository) error) error
}
