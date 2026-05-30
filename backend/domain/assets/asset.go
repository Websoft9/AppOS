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

	LanguageShell      = "shell"
	LanguageBash       = "bash"
	LanguageZsh        = "zsh"
	LanguagePython     = "python"
	LanguageJavaScript = "javascript"
	LanguageTypeScript = "typescript"
	LanguagePowerShell = "powershell"
	LanguageRuby       = "ruby"
	LanguagePerl       = "perl"
	LanguagePHP        = "php"
	LanguageLua        = "lua"
	LanguageGroovy     = "groovy"
	LanguageR          = "r"
	LanguageOther      = "other"
)

type ScriptLanguageDefinition struct {
	Code             string
	DefaultExtension string
}

var (
	SupportedKinds        = []string{KindScript, KindSkill}
	SupportedStorageKinds = []string{StorageFile, StorageFolder}
	SupportedSourceKinds  = []string{SourceLocal, SourceReference}
	ScriptLanguages       = []ScriptLanguageDefinition{
		{Code: LanguageShell, DefaultExtension: "sh"},
		{Code: LanguageBash, DefaultExtension: "bash"},
		{Code: LanguageZsh, DefaultExtension: "zsh"},
		{Code: LanguagePython, DefaultExtension: "py"},
		{Code: LanguageJavaScript, DefaultExtension: "js"},
		{Code: LanguageTypeScript, DefaultExtension: "ts"},
		{Code: LanguagePowerShell, DefaultExtension: "ps1"},
		{Code: LanguageRuby, DefaultExtension: "rb"},
		{Code: LanguagePerl, DefaultExtension: "pl"},
		{Code: LanguagePHP, DefaultExtension: "php"},
		{Code: LanguageLua, DefaultExtension: "lua"},
		{Code: LanguageGroovy, DefaultExtension: "groovy"},
		{Code: LanguageR, DefaultExtension: "r"},
		{Code: LanguageOther, DefaultExtension: ""},
	}
	SupportedLanguages = scriptLanguageCodes()

	nonSlugPattern   = regexp.MustCompile(`[^a-z0-9]+`)
	scriptExtPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9+_-]*$`)
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

func (a *Asset) ID() string              { return a.rec.Id }
func (a *Asset) Name() string            { return a.rec.GetString("name") }
func (a *Asset) Description() string     { return a.rec.GetString("description") }
func (a *Asset) Kind() string            { return a.rec.GetString("kind") }
func (a *Asset) StorageKind() string     { return a.rec.GetString("storage_kind") }
func (a *Asset) SourceKind() string      { return a.rec.GetString("source_kind") }
func (a *Asset) Language() string        { return a.rec.GetString("language") }
func (a *Asset) ScriptExtension() string { return a.rec.GetString("script_extension") }
func (a *Asset) Reference() string       { return a.rec.GetString("reference") }
func (a *Asset) Path() string            { return a.rec.GetString("path") }
func (a *Asset) Entrypoint() string      { return a.rec.GetString("entrypoint") }
func (a *Asset) IsLocal() bool           { return a.SourceKind() == SourceLocal }
func (a *Asset) IsReference() bool       { return a.SourceKind() == SourceReference }
func (a *Asset) IsSingleFile() bool      { return a.StorageKind() == StorageFile }
func (a *Asset) IsFolder() bool          { return a.StorageKind() == StorageFolder }

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
func ScriptFileName(name, assetID, language, customExtension string) string {
	base := StorageDirName(name, assetID)
	return base + ScriptFileExt(language, customExtension)
}

// ScriptFileExt returns the canonical phase-1 extension for a script language.
func ScriptFileExt(language, customExtension string) string {
	definition, ok := findScriptLanguage(strings.TrimSpace(strings.ToLower(language)))
	if ok && definition.DefaultExtension != "" {
		return "." + definition.DefaultExtension
	}
	if normalized := NormalizeScriptExtension(customExtension); normalized != "" {
		return "." + normalized
	}
	return ".txt"
}

func NormalizeScriptExtension(value string) string {
	normalized := strings.TrimSpace(strings.ToLower(value))
	normalized = strings.TrimLeft(normalized, ".")
	return normalized
}

func ValidScriptExtension(value string) bool {
	return scriptExtPattern.MatchString(NormalizeScriptExtension(value))
}

func scriptLanguageCodes() []string {
	codes := make([]string, 0, len(ScriptLanguages))
	for _, definition := range ScriptLanguages {
		codes = append(codes, definition.Code)
	}
	return codes
}

func findScriptLanguage(language string) (ScriptLanguageDefinition, bool) {
	for _, definition := range ScriptLanguages {
		if definition.Code == language {
			return definition, true
		}
	}
	return ScriptLanguageDefinition{}, false
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
