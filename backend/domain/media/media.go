package media

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

const (
	Collection      = "media"
	BaseContentPath = "/appos/data/media"

	ScopePublic  = "public"
	ScopePrivate = "private"

	CategoryBranding = "branding"
	CategoryAvatar   = "avatar"
	CategoryGeneral  = "general"

	OwnerTypeSystem = "system"
	OwnerTypeUser   = "user"
	OwnerTypeOther  = "other"
)

var (
	SupportedScopes     = []string{ScopePublic, ScopePrivate}
	SupportedCategories = []string{CategoryBranding, CategoryAvatar, CategoryGeneral}
	SupportedOwnerTypes = []string{OwnerTypeSystem, OwnerTypeUser, OwnerTypeOther}
)

type Media struct {
	rec *core.Record
}

func From(rec *core.Record) *Media {
	return &Media{rec: rec}
}

func (m *Media) ID() string           { return m.rec.Id }
func (m *Media) Scope() string        { return m.rec.GetString("scope") }
func (m *Media) Category() string     { return m.rec.GetString("category") }
func (m *Media) OwnerType() string    { return m.rec.GetString("owner_type") }
func (m *Media) OwnerID() string      { return m.rec.GetString("owner_id") }
func (m *Media) OriginalName() string { return m.rec.GetString("original_name") }
func (m *Media) ContentType() string  { return m.rec.GetString("content_type") }
func (m *Media) StoragePath() string  { return m.rec.GetString("storage_path") }
func (m *Media) PublicURL() string    { return m.rec.GetString("public_url") }

func RelativePath(scope, category, id, originalName string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(originalName), "."))
	if ext == "jpeg" {
		ext = "jpg"
	}
	if ext == "" {
		ext = "bin"
	}
	return filepath.ToSlash(filepath.Join(scope, category, fmt.Sprintf("%s.%s", id, ext)))
}
