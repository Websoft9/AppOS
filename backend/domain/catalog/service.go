package catalog

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

type PersonalizationState struct {
	IsFavorite bool
	Note       string
}

type Service struct{}

func NewService() *Service {
	return &Service{}
}

func (s *Service) Categories(app core.App, auth *core.Record, locale string) (*CategoryTreeResponse, error) {
	bundle, err := LoadBundle(locale)
	if err != nil {
		return nil, err
	}

	summaries, err := s.buildSummaries(app, auth, Query{Locale: locale, Source: "all", Visibility: "all", Limit: 10000}, bundle)
	if err != nil {
		return nil, err
	}

	primaryCounts := map[string]int{}
	secondaryCounts := map[string]int{}
	for _, item := range summaries {
		if item.PrimaryCategory != nil {
			primaryCounts[item.PrimaryCategory.Key]++
		}
		for _, secondary := range item.SecondaryCategories {
			secondaryCounts[secondary.Key]++
		}
	}

	items := make([]CategoryNode, 0, len(bundle.Categories))
	for _, primary := range bundle.Categories {
		children := make([]CategoryChild, 0, len(primary.LinkedFrom.CatalogCollection.Items))
		for _, secondary := range primary.LinkedFrom.CatalogCollection.Items {
			secondaryKey := strings.TrimSpace(secondary.Key)
			children = append(children, CategoryChild{
				Key:       secondaryKey,
				Title:     secondary.Title,
				Position:  numberToIntPtr(secondary.Position),
				AppCount:  secondaryCounts[secondaryKey],
				ParentKey: primary.Key,
			})
		}
		sort.SliceStable(children, func(i, j int) bool {
			return positionLess(children[i].Position, children[j].Position, children[i].Title, children[j].Title)
		})

		items = append(items, CategoryNode{
			Key:      primary.Key,
			Title:    primary.Title,
			Position: numberToIntPtr(primary.Position),
			AppCount: primaryCounts[primary.Key],
			Children: children,
		})
	}

	sort.SliceStable(items, func(i, j int) bool {
		return positionLess(items[i].Position, items[j].Position, items[i].Title, items[j].Title)
	})

	return &CategoryTreeResponse{
		Items: items,
		Meta: ResponseMeta{Locale: bundle.Locale, SourceVersion: bundle.SourceVersion},
	}, nil
}

func (s *Service) Apps(app core.App, auth *core.Record, query Query) (*AppListResponse, error) {
	bundle, err := LoadBundle(query.Locale)
	if err != nil {
		return nil, err
	}

	summaries, err := s.buildSummaries(app, auth, query, bundle)
	if err != nil {
		return nil, err
	}

	total := len(summaries)
	start := minInt(query.Offset, total)
	end := minInt(start+query.Limit, total)

	return &AppListResponse{
		Items: summaries[start:end],
		Page: AppListPage{
			Limit:   query.Limit,
			Offset:  query.Offset,
			Total:   total,
			HasMore: end < total,
		},
		Meta: ResponseMeta{Locale: bundle.Locale, SourceVersion: bundle.SourceVersion},
	}, nil
}

func (s *Service) AppDetail(app core.App, auth *core.Record, locale, key string) (*AppDetailResponse, error) {
	bundle, err := LoadBundle(locale)
	if err != nil {
		return nil, err
	}
	personalization, err := loadPersonalization(app, auth)
	if err != nil {
		return nil, err
	}
	secondaryToPrimary, secondaryTitles := categoryIndex(bundle.Categories)

	if custom, ok, err := loadVisibleCustomAppDetail(app, auth, key, secondaryToPrimary, secondaryTitles, personalization); err != nil {
		return nil, err
	} else if ok {
		return custom, nil
	}

	for _, product := range bundle.Products {
		if product.Key != key {
			continue
		}
		return officialDetail(product, personalization[key], bundle.SourceVersion, locale), nil
	}

	return nil, fmt.Errorf("catalog app not found")
}

func (s *Service) DeploySource(app core.App, auth *core.Record, locale, key string) (*DeploySourceResponse, error) {
	bundle, err := LoadBundle(locale)
	if err != nil {
		return nil, err
	}

	if customRecord, ok, err := findVisibleCustomAppRecord(app, auth, key); err != nil {
		return nil, err
	} else if ok {
		available := customTemplateAvailable(key, customRecord.GetString("compose_yaml"))
		return &DeploySourceResponse{
			App: DeploySourceApp{Key: key, Title: customRecord.GetString("trademark"), Source: "custom"},
			Template: TemplateSummary{Key: key, Source: "template", Available: available},
			Install: InstallPrefill{
				PrefillMode:    "target",
				PrefillSource:  "template",
				PrefillAppKey:  key,
				PrefillAppName: customRecord.GetString("trademark"),
			},
			Capabilities: DeployCapabilities{
				HasComposeTemplate: available,
				HasEnvTemplate:     fileExists(filepath.Join("/appos/data/templates/apps", key, ".env")),
				SupportsDirectDeploy: available,
			},
		}, nil
	}

	for _, product := range bundle.Products {
		if product.Key != key {
			continue
		}
		return &DeploySourceResponse{
			App: DeploySourceApp{Key: key, Title: product.Trademark, Source: "official"},
			Template: TemplateSummary{Key: key, Source: "library", Available: true},
			Install: InstallPrefill{
				PrefillMode:    "target",
				PrefillSource:  "library",
				PrefillAppKey:  key,
				PrefillAppName: product.Trademark,
			},
			Capabilities: DeployCapabilities{
				HasComposeTemplate: true,
				HasEnvTemplate:     fileExists(filepath.Join("/appos/library/apps", key, ".env")),
				SupportsDirectDeploy: true,
			},
		}, nil
	}

	return nil, fmt.Errorf("catalog app not found")
}

func (s *Service) Personalization(app core.App, auth *core.Record) (*PersonalizationListResponse, error) {
	if auth == nil {
		return nil, fmt.Errorf("authentication required")
	}

	state, err := loadPersonalization(app, auth)
	if err != nil {
		return nil, err
	}
	records, err := app.FindAllRecords("store_user_apps")
	if err != nil {
		return nil, fmt.Errorf("list personalization records: %w", err)
	}

	items := make([]PersonalizationRecord, 0, len(state))
	for _, record := range records {
		if record.GetString("user") != auth.Id {
			continue
		}
		appKey := record.GetString("app_key")
		current := state[appKey]
		items = append(items, PersonalizationRecord{
			AppKey:     appKey,
			IsFavorite: current.IsFavorite,
			Note:       notePtr(current.Note),
			CreatedAt:  stringPtr(record.GetString("created")),
			UpdatedAt:  stringPtr(record.GetString("updated")),
		})
	}

	sort.SliceStable(items, func(i, j int) bool {
		if items[i].IsFavorite != items[j].IsFavorite {
			return items[i].IsFavorite
		}
		return items[i].AppKey < items[j].AppKey
	})

	return &PersonalizationListResponse{Items: items}, nil
}

func (s *Service) SetFavorite(app core.App, auth *core.Record, appKey string, isFavorite bool) (*PersonalizationRecord, error) {
	if auth == nil {
		return nil, fmt.Errorf("authentication required")
	}
	if err := ensureCatalogAppExists(app, auth, appKey); err != nil {
		return nil, err
	}

	record, existed, err := findOrCreatePersonalizationRecord(app, auth, appKey)
	if err != nil {
		return nil, err
	}
	record.Set("is_favorite", isFavorite)

	if !isFavorite && strings.TrimSpace(record.GetString("note")) == "" {
		if existed {
			if err := app.Delete(record); err != nil {
				return nil, fmt.Errorf("delete empty personalization record: %w", err)
			}
		}
		return &PersonalizationRecord{AppKey: appKey, IsFavorite: false}, nil
	}

	if err := app.Save(record); err != nil {
		return nil, fmt.Errorf("save favorite state: %w", err)
	}
	return personalizationRecord(record), nil
}

func (s *Service) SetNote(app core.App, auth *core.Record, appKey string, note *string) (*PersonalizationRecord, error) {
	if auth == nil {
		return nil, fmt.Errorf("authentication required")
	}
	if err := ensureCatalogAppExists(app, auth, appKey); err != nil {
		return nil, err
	}

	normalized := ""
	if note != nil {
		normalized = strings.TrimSpace(*note)
	}

	record, existed, err := findOrCreatePersonalizationRecord(app, auth, appKey)
	if err != nil {
		return nil, err
	}
	record.Set("note", normalized)

	if !record.GetBool("is_favorite") && normalized == "" {
		if existed {
			if err := app.Delete(record); err != nil {
				return nil, fmt.Errorf("delete empty personalization record: %w", err)
			}
		}
		return &PersonalizationRecord{AppKey: appKey, IsFavorite: false}, nil
	}

	if err := app.Save(record); err != nil {
		return nil, fmt.Errorf("save note state: %w", err)
	}
	return personalizationRecord(record), nil
}

func (s *Service) ClearNote(app core.App, auth *core.Record, appKey string) (*PersonalizationRecord, error) {
	empty := ""
	return s.SetNote(app, auth, appKey, &empty)
}

func (s *Service) buildSummaries(app core.App, auth *core.Record, query Query, bundle *Bundle) ([]AppSummary, error) {
	secondaryToPrimary, secondaryTitles := categoryIndex(bundle.Categories)
	personalization, err := loadPersonalization(app, auth)
	if err != nil {
		return nil, err
	}
	customApps, err := loadVisibleCustomApps(app, auth, secondaryToPrimary, secondaryTitles, personalization)
	if err != nil {
		return nil, err
	}

	items := make([]AppSummary, 0, len(bundle.Products)+len(customApps))
	if query.Source == "all" || query.Source == "official" {
		for _, product := range bundle.Products {
			items = append(items, summarizeOfficial(product, personalization[product.Key], bundle.SourceVersion))
		}
	}
	if query.Source == "all" || query.Source == "custom" {
		items = append(items, customApps...)
	}

	filtered := make([]AppSummary, 0, len(items))
	for _, item := range items {
		if matchesFilters(item, query) {
			filtered = append(filtered, item)
		}
	}

	sort.SliceStable(filtered, func(i, j int) bool {
		if filtered[i].Source != filtered[j].Source {
			return filtered[i].Source == "custom"
		}
		return strings.ToLower(filtered[i].Title) < strings.ToLower(filtered[j].Title)
	})

	return filtered, nil
}

func summarizeOfficial(product SourceProduct, state PersonalizationState, sourceVersion string) AppSummary {
	secondary := make([]CategoryRef, 0, len(product.CatalogCollection.Items))
	var primary *CategoryRef
	for idx, item := range product.CatalogCollection.Items {
		secondary = append(secondary, CategoryRef{Key: strings.TrimSpace(item.Key), Title: item.Title})
		if idx == 0 && len(item.CatalogCollection.Items) > 0 {
			primary = &CategoryRef{Key: strings.TrimSpace(item.CatalogCollection.Items[0].Key), Title: item.CatalogCollection.Items[0].Title}
		}
	}
	badges := []string{}
	if product.Hot > 0 {
		badges = append(badges, "hot")
	}

	return AppSummary{
		Key:                 product.Key,
		Title:               product.Trademark,
		Overview:            firstNonEmpty(product.Summary, product.Overview),
		IconURL:             product.Logo.ImageURL,
		Source:              "official",
		Visibility:          "public",
		PrimaryCategory:     primary,
		SecondaryCategories: secondary,
		Badges:              badges,
		Template:            TemplateSummary{Key: product.Key, Source: "library", Available: true},
		Personalization: PersonalizationSummary{
			IsFavorite: state.IsFavorite,
			HasNote:    strings.TrimSpace(state.Note) != "",
		},
		UpdatedAt: sourceVersion,
	}
}

func loadVisibleCustomApps(app core.App, auth *core.Record, secondaryToPrimary map[string]CategoryRef, secondaryTitles map[string]string, personalization map[string]PersonalizationState) ([]AppSummary, error) {
	records, err := app.FindAllRecords("store_custom_apps")
	if err != nil {
		return nil, fmt.Errorf("list custom apps: %w", err)
	}

	authID := ""
	if auth != nil {
		authID = auth.Id
	}

	items := make([]AppSummary, 0, len(records))
	for _, record := range records {
		visibility := record.GetString("visibility")
		createdBy := record.GetString("created_by")
		if visibility != "shared" && createdBy != authID {
			continue
		}

		secondaryKeys, err := stringSliceFromAny(record.Get("category_keys"))
		if err != nil {
			secondaryKeys = nil
		}
		secondary := make([]CategoryRef, 0, len(secondaryKeys))
		var primary *CategoryRef
		for _, key := range secondaryKeys {
			secondary = append(secondary, CategoryRef{Key: key, Title: secondaryTitles[key]})
			if primary == nil {
				if parent, ok := secondaryToPrimary[key]; ok {
					copy := parent
					primary = &copy
				}
			}
		}

		customKey := record.GetString("key")
		items = append(items, AppSummary{
			Key:                 customKey,
			Title:               record.GetString("trademark"),
			Overview:            record.GetString("overview"),
			IconURL:             record.GetString("logo_url"),
			Source:              "custom",
			Visibility:          visibility,
			PrimaryCategory:     primary,
			SecondaryCategories: secondary,
			Badges:              []string{"custom"},
			Template: TemplateSummary{
				Key:       customKey,
				Source:    "template",
				Available: customTemplateAvailable(customKey, record.GetString("compose_yaml")),
			},
			Personalization: PersonalizationSummary{
				IsFavorite: personalization[customKey].IsFavorite,
				HasNote:    strings.TrimSpace(personalization[customKey].Note) != "",
			},
			UpdatedAt: record.GetString("updated"),
		})
	}

	return items, nil
}

func loadVisibleCustomAppDetail(app core.App, auth *core.Record, key string, secondaryToPrimary map[string]CategoryRef, secondaryTitles map[string]string, personalization map[string]PersonalizationState) (*AppDetailResponse, bool, error) {
	record, ok, err := findVisibleCustomAppRecord(app, auth, key)
	if err != nil || !ok {
		return nil, ok, err
	}

	secondaryKeys, err := stringSliceFromAny(record.Get("category_keys"))
	if err != nil {
		secondaryKeys = nil
	}
	secondary := make([]CategoryRef, 0, len(secondaryKeys))
	var primary *CategoryRef
	for _, secondaryKey := range secondaryKeys {
		secondary = append(secondary, CategoryRef{Key: secondaryKey, Title: secondaryTitles[secondaryKey]})
		if primary == nil {
			if parent, exists := secondaryToPrimary[secondaryKey]; exists {
				copy := parent
				primary = &copy
			}
		}
	}

	customKey := record.GetString("key")
	createdBy := record.GetString("created_by")
	state := personalization[customKey]
	note := notePtr(state.Note)
	recordID := record.Id
	author := createdBy
	return &AppDetailResponse{
		Key:         customKey,
		Title:       record.GetString("trademark"),
		Overview:    record.GetString("overview"),
		Description: record.GetString("description"),
		IconURL:     record.GetString("logo_url"),
		Screenshots: []Screenshot{},
		Source: SourceDetail{
			Kind:       "custom",
			Visibility: record.GetString("visibility"),
			Author:     &author,
			RecordID:   &recordID,
		},
		Categories: CategoryDetail{Primary: primary, Secondary: secondary},
		Links: LinkSet{
			Github: buildGithubURL(customKey),
			Docs:   buildDocURL(customKey, "en"),
		},
		Requirements: Requirements{},
		Template: TemplateDetail{
			Key:       customKey,
			Source:    "template",
			Available: customTemplateAvailable(customKey, record.GetString("compose_yaml")),
			PathHint:  filepath.Join("templates/apps", customKey),
		},
		Deploy: DeployDetail{
			Supported:      customTemplateAvailable(customKey, record.GetString("compose_yaml")),
			Mode:           "template",
			SourceKind:     "template",
			DefaultAppName: record.GetString("trademark"),
		},
		Personalization: PersonalizationDetail{IsFavorite: state.IsFavorite, Note: note},
		Audit: AuditDetail{CreatedAt: stringPtr(record.GetString("created")), UpdatedAt: stringPtr(record.GetString("updated"))},
	}, true, nil
}

func findVisibleCustomAppRecord(app core.App, auth *core.Record, key string) (*core.Record, bool, error) {
	records, err := app.FindAllRecords("store_custom_apps")
	if err != nil {
		return nil, false, fmt.Errorf("list custom apps: %w", err)
	}
	authID := ""
	if auth != nil {
		authID = auth.Id
	}
	for _, record := range records {
		if record.GetString("key") != key {
			continue
		}
		if record.GetString("visibility") == "shared" || record.GetString("created_by") == authID {
			return record, true, nil
		}
		return nil, false, nil
	}
	return nil, false, nil
}

func officialDetail(product SourceProduct, state PersonalizationState, sourceVersion, locale string) *AppDetailResponse {
	secondary := make([]CategoryRef, 0, len(product.CatalogCollection.Items))
	var primary *CategoryRef
	for idx, item := range product.CatalogCollection.Items {
		secondary = append(secondary, CategoryRef{Key: strings.TrimSpace(item.Key), Title: item.Title})
		if idx == 0 && len(item.CatalogCollection.Items) > 0 {
			primary = &CategoryRef{Key: strings.TrimSpace(item.CatalogCollection.Items[0].Key), Title: item.CatalogCollection.Items[0].Title}
		}
	}
	screenshots := make([]Screenshot, 0, len(product.Screenshots))
	for _, shot := range product.Screenshots {
		screenshots = append(screenshots, Screenshot{Key: shot.Key, URL: shot.Value})
	}
	note := notePtr(state.Note)
	return &AppDetailResponse{
		Key:         product.Key,
		Title:       product.Trademark,
		Overview:    firstNonEmpty(product.Summary, product.Overview),
		Description: product.Description,
		IconURL:     product.Logo.ImageURL,
		Screenshots: screenshots,
		Source: SourceDetail{Kind: "official", Visibility: "public"},
		Categories: CategoryDetail{Primary: primary, Secondary: secondary},
		Links: LinkSet{
			Website: product.WebsiteURL,
			Docs:    buildDocURL(product.Key, locale),
			Github:  buildGithubURL(product.Key),
		},
		Requirements: Requirements{VCpu: product.VCpu, MemoryGB: product.Memory, StorageGB: product.Storage},
		Template: TemplateDetail{Key: product.Key, Source: "library", Available: true, PathHint: filepath.Join("library/apps", product.Key)},
		Deploy: DeployDetail{Supported: true, Mode: "template", SourceKind: "library", DefaultAppName: product.Trademark},
		Personalization: PersonalizationDetail{IsFavorite: state.IsFavorite, Note: note},
		Audit: AuditDetail{UpdatedAt: stringPtr(sourceVersion)},
	}
}

func loadPersonalization(app core.App, auth *core.Record) (map[string]PersonalizationState, error) {
	state := map[string]PersonalizationState{}
	if auth == nil {
		return state, nil
	}

	records, err := app.FindAllRecords("store_user_apps")
	if err != nil {
		return nil, fmt.Errorf("list personalization: %w", err)
	}
	for _, record := range records {
		if record.GetString("user") != auth.Id {
			continue
		}
		state[record.GetString("app_key")] = PersonalizationState{
			IsFavorite: record.GetBool("is_favorite"),
			Note:       record.GetString("note"),
		}
	}
	return state, nil
}

func ensureCatalogAppExists(app core.App, auth *core.Record, key string) error {
	bundle, err := LoadBundle("en")
	if err != nil {
		return err
	}
	for _, product := range bundle.Products {
		if product.Key == key {
			return nil
		}
	}
	if _, ok, err := findVisibleCustomAppRecord(app, auth, key); err != nil {
		return err
	} else if ok {
		return nil
	}
	return fmt.Errorf("catalog app not found")
}

func findOrCreatePersonalizationRecord(app core.App, auth *core.Record, appKey string) (*core.Record, bool, error) {
	records, err := app.FindAllRecords("store_user_apps")
	if err != nil {
		return nil, false, fmt.Errorf("list personalization records: %w", err)
	}
	for _, record := range records {
		if record.GetString("user") == auth.Id && record.GetString("app_key") == appKey {
			return record, true, nil
		}
	}
	col, err := app.FindCollectionByNameOrId("store_user_apps")
	if err != nil {
		return nil, false, err
	}
	record := core.NewRecord(col)
	record.Set("user", auth.Id)
	record.Set("app_key", appKey)
	record.Set("is_favorite", false)
	record.Set("note", "")
	return record, false, nil
}

func personalizationRecord(record *core.Record) *PersonalizationRecord {
	return &PersonalizationRecord{
		AppKey:     record.GetString("app_key"),
		IsFavorite: record.GetBool("is_favorite"),
		Note:       notePtr(record.GetString("note")),
		CreatedAt:  stringPtr(record.GetString("created")),
		UpdatedAt:  stringPtr(record.GetString("updated")),
	}
}

func categoryIndex(categories []SourceCategory) (map[string]CategoryRef, map[string]string) {
	secondaryToPrimary := map[string]CategoryRef{}
	secondaryTitles := map[string]string{}
	for _, primary := range categories {
		parent := CategoryRef{Key: primary.Key, Title: primary.Title}
		for _, child := range primary.LinkedFrom.CatalogCollection.Items {
			key := strings.TrimSpace(child.Key)
			secondaryToPrimary[key] = parent
			secondaryTitles[key] = child.Title
		}
	}
	return secondaryToPrimary, secondaryTitles
}

func matchesFilters(item AppSummary, query Query) bool {
	if query.Visibility != "all" {
		if item.Source != "custom" {
			return false
		}
		switch query.Visibility {
		case "shared":
			if item.Visibility != "shared" {
				return false
			}
		case "owned":
			if item.Visibility != "private" {
				return false
			}
		}
	}

	if query.PrimaryCategory != "" {
		if item.PrimaryCategory == nil || item.PrimaryCategory.Key != query.PrimaryCategory {
			return false
		}
	}
	if query.SecondaryCategory != "" {
		matched := false
		for _, secondary := range item.SecondaryCategories {
			if secondary.Key == query.SecondaryCategory {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}
	if query.Search != "" {
		needle := strings.ToLower(strings.TrimSpace(query.Search))
		haystack := strings.ToLower(item.Key + "\n" + item.Title + "\n" + item.Overview)
		if !strings.Contains(haystack, needle) {
			return false
		}
	}
	if query.Favorite != nil && item.Personalization.IsFavorite != *query.Favorite {
		return false
	}
	return true
}

func stringSliceFromAny(v any) ([]string, error) {
	if v == nil {
		return nil, nil
	}
	if values, ok := v.([]string); ok {
		result := make([]string, 0, len(values))
		for _, value := range values {
			trimmed := strings.TrimSpace(value)
			if trimmed != "" {
				result = append(result, trimmed)
			}
		}
		return result, nil
	}

	var raw []byte
	switch value := v.(type) {
	case []byte:
		raw = value
	case string:
		raw = []byte(value)
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		raw = encoded
	}
	if len(raw) == 0 {
		return nil, nil
	}

	var parsed []string
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	result := make([]string, 0, len(parsed))
	for _, value := range parsed {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result, nil
}

func customTemplateAvailable(key, composeYAML string) bool {
	if strings.TrimSpace(composeYAML) != "" {
		return true
	}
	info, err := os.Stat(filepath.Join("/appos/data/templates/apps", key))
	return err == nil && info.IsDir()
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func buildDocURL(appKey, locale string) string {
	if locale == "zh" {
		return "https://support.websoft9.com/docs/" + appKey
	}
	return "https://support.websoft9.com/en/docs/" + appKey
}

func buildGithubURL(appKey string) string {
	return "https://github.com/Websoft9/docker-library/tree/main/apps/" + appKey
}

func stringPtr(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	copy := value
	return &copy
}

func notePtr(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	copy := value
	return &copy
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func positionLess(a, b *int, titleA, titleB string) bool {
	av, bv := 999999, 999999
	if a != nil {
		av = *a
	}
	if b != nil {
		bv = *b
	}
	if av != bv {
		return av < bv
	}
	return strings.ToLower(titleA) < strings.ToLower(titleB)
}

func numberToIntPtr(value *float64) *int {
	if value == nil {
		return nil
	}
	converted := int(*value)
	return &converted
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}