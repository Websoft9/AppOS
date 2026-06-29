package connectors

type Repository interface {
	List() ([]*Connector, error)
	Get(id string) (*Connector, error)
	New() (*Connector, error)
	ExistsByName(name string, excludeID string) (bool, error)
	Save(connector *Connector) error
	Delete(connector *Connector) error
	ListByKind(kind string) ([]*Connector, error)
	ClearDefaultsByKind(kind string, excludeID string) error
	RunInTransaction(func(Repository) error) error
}
