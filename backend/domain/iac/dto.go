package iac

import "time"

// Entry is the IaC-facing file or directory projection returned by read-side use cases.
type Entry struct {
	Name       string
	Type       string
	Size       int64
	ModifiedAt time.Time
}

// FileContent is the IaC-facing text file projection returned by read-side use cases.
type FileContent struct {
	Path       string
	Content    string
	Size       int64
	ModifiedAt time.Time
}

// DownloadFile is the IaC-facing file projection used for attachment downloads.
type DownloadFile struct {
	Path     string
	AbsPath  string
	Filename string
}