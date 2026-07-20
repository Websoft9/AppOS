package iac

import (
	"io"

	"github.com/websoft9/appos/backend/infra/filesvc"
)

// ReadPort is the minimum filesystem capability needed for IaC read-side use cases.
type ReadPort interface {
	List(path string) ([]filesvc.Entry, error)
	ReadFile(path string) ([]byte, filesvc.Entry, error)
}

// LibraryPort is the minimum read-only library capability needed for current IaC use cases.
type LibraryPort interface {
	ReadPort
	Stat(path string) (filesvc.Entry, error)
}

// WorkspacePort is the minimum workspace capability needed for current IaC use cases.
type WorkspacePort interface {
	ReadPort
	Stat(path string) (filesvc.Entry, error)
	Resolve(path string) (string, error)
	WriteFile(path string, data []byte, overwrite bool) (filesvc.Entry, error)
	WriteReader(path string, reader io.Reader, overwrite bool, maxBytes int64) (filesvc.Entry, error)
	Mkdir(path string) (filesvc.Entry, error)
	Delete(path string, recursive bool) error
	Move(fromPath string, toPath string, overwrite bool) (filesvc.Entry, error)
}

// CrossCopyPort copies content from the IaC library boundary into the IaC workspace boundary.
type CrossCopyPort interface {
	CopyLibraryToWorkspace(fromPath string, toPath string, overwrite bool) error
}
