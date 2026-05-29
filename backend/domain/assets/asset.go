package assets

import (
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

const (
	Collection      = "assets"
	BaseContentPath = "/appos/data/assets"

	KindScript = "script"
	KindSkill  = "skill"

	StorageFile   = "file"
	StorageFolder = "folder"

	SourceLocal     = "local"
	SourceReference = "reference"

	LanguageShell  = "shell"
	LanguagePython = "python"
	LanguageOther  = "other"
)

var (
	SupportedKinds        = []string{KindScript, KindSkill}
	SupportedStorageKinds = []string{StorageFile, StorageFolder}
	SupportedSourceKinds  = []string{SourceLocal, SourceReference}
	SupportedLanguages    = []string{LanguageShell, LanguagePython, LanguageOther}

	nonSlugPattern = regexp.MustCompile(`[^a-z0-9]+`)
)

// Asset is the aggregate root for the Assets domain.
// It wraps a PocketBase record and exposes typed accessors for the canonical
// phase-1 asset model.
type Asset struct {
	rec *core.Record
}

// From wraps a PocketBase record as an Asset aggregate root.
func From(rec *core.Record) *Asset {
	return &Asset{rec: rec}
}

// Record returns the underlying PocketBase record for persistence operations.
func (a *Asset) Record() *core.Record { return a.rec }

func (a *Asset) ID() string          { return a.rec.Id }
func (a *Asset) Name() string        { return a.rec.GetString("name") }
func (a *Asset) Description() string  { return a.rec.GetString("description") }
func (a *Asset) Kind() string        { return a.rec.GetString("kind") }
func (a *Asset) StorageKind() string { return a.rec.GetString("storage_kind") }
func (a *Asset) SourceKind() string  { return a.rec.GetString("source_kind") }
func (a *Asset) Language() string    { return a.rec.GetString("language") }
func (a *Asset) Reference() string   { return a.rec.GetString("reference") }
func (a *Asset) Path() string        { return a.rec.GetString("path") }
func (a *Asset) Entrypoint() string  { return a.rec.GetString("entrypoint") }
func (a *Asset) IsLocal() bool       { return a.SourceKind() == SourceLocal }
func (a *Asset) IsReference() bool   { return a.SourceKind() == SourceReference }
func (a *Asset) IsSingleFile() bool  { return a.StorageKind() == StorageFile }
func (a *Asset) IsFolder() bool      { return a.StorageKind() == StorageFolder }

// StorageDirName returns the canonical filesystem directory name for this asset.
func (a *Asset) StorageDirName() string {
	return StorageDirName(a.Name(), a.ID())
}

// StoragePath returns the canonical filesystem directory path for this asset.
func (a *Asset) StoragePath() string {
	return filepath.Join(BaseContentPath, a.StorageDirName())
}

// StorageDirName returns the canonical `{assetName}-{assetId}` directory name.
func StorageDirName(name, assetID string) string {
	slug := SlugName(name)
	assetID = strings.TrimSpace(assetID)
	if assetID == "" {
		return slug
	}
	return slug + "-" + assetID
}

// StoragePath returns the canonical phase-1 filesystem path for an asset.
func StoragePath(name, assetID string) string {
	return filepath.Join(BaseContentPath, StorageDirName(name, assetID))
}

// ScriptFileName returns the derived script filename stored under the asset directory.
func ScriptFileName(name, assetID, language string) string {
	base := StorageDirName(name, assetID)
	return base + ScriptFileExt(language)
}

// ScriptFileExt returns the canonical phase-1 extension for a script language.
func ScriptFileExt(language string) string {
	switch strings.TrimSpace(strings.ToLower(language)) {
	case LanguagePython:
		return ".py"
	case LanguageOther:
		return ".txt"
	default:
		return ".sh"
	}
}

// SlugName normalizes the user-facing asset name into a filesystem-safe slug.
func SlugName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	name = nonSlugPattern.ReplaceAllString(name, "-")
	name = strings.Trim(name, "-")
	if name == "" {
		return "asset"
	}
	return name
}
