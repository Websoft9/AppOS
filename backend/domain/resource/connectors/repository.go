package connectors

type Repository interface {
	List() ([]*Connector, error)
	Get(id string) (*Connector, error)
	New() (*Connector, error)
	ExistsByName(name string, excludeID string) (bool, error)
	Save(connector *Connector) error
	Delete(connector *Connector) error
	ListByKind(kind string) ([]*Connector, error)
	// ClearDefaultsByKind sets is_default=false for all connectors of the given
	// kind except the one identified by excludeID. If kind is empty, it is a
	// silent no-op (the service layer guarantees kind is non-empty before calling).
	ClearDefaultsByKind(kind string, excludeID string) error
	RunInTransaction(func(Repository) error) error
}
