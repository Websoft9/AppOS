package instances

type Repository interface {
	List() ([]*Instance, error)
	Get(id string) (*Instance, error)
	New() (*Instance, error)
	ExistsByName(name string, excludeID string) (bool, error)
	Save(instance *Instance) error
	Delete(instance *Instance) error
	RunInTransaction(func(Repository) error) error
}
