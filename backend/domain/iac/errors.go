package iac

import "errors"

var (
	ErrInvalidPath         = errors.New("invalid path")
	ErrNotFound            = errors.New("not found")
	ErrDirectoryRequired   = errors.New("directory required")
	ErrFileRequired        = errors.New("file required")
	ErrConflict            = errors.New("conflict")
	ErrBinaryContent       = errors.New("binary content not supported")
	ErrLimitExceeded       = errors.New("limit exceeded")
	ErrRootDeleteDenied    = errors.New("root delete denied")
	ErrCrossRootMoveDenied = errors.New("cross-root move denied")
	ErrInvalidFilename     = errors.New("invalid filename")
	ErrExtensionBlocked    = errors.New("extension blocked")
)
