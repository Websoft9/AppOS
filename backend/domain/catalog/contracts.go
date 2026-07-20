package catalog

type CategoryRef struct {
	Key   string `json:"key"`
	Title string `json:"title"`
}

type PersonalizationSummary struct {
	IsFavorite bool `json:"isFavorite"`
	HasNote    bool `json:"hasNote"`
}

type TemplateSummary struct {
	Key       string `json:"key"`
	Source    string `json:"source"`
	Available bool   `json:"available"`
}

type AppSummary struct {
	Key                 string                 `json:"key"`
	Title               string                 `json:"title"`
	Overview            string                 `json:"overview"`
	IconURL             string                 `json:"iconUrl,omitempty"`
	Hot                 int                    `json:"-"`
	PrimaryCategoryKeys []string               `json:"-"`
	Source              string                 `json:"source"`
	Visibility          string                 `json:"visibility"`
	PrimaryCategory     *CategoryRef           `json:"primaryCategory,omitempty"`
	SecondaryCategories []CategoryRef          `json:"secondaryCategories"`
	Badges              []string               `json:"badges"`
	Template            TemplateSummary        `json:"template"`
	Personalization     PersonalizationSummary `json:"personalization"`
	UpdatedAt           string                 `json:"updatedAt,omitempty"`
}

type AppListPage struct {
	Limit   int  `json:"limit"`
	Offset  int  `json:"offset"`
	Total   int  `json:"total"`
	HasMore bool `json:"hasMore"`
}

type ResponseMeta struct {
	Locale        string `json:"locale"`
	SourceVersion string `json:"sourceVersion"`
}

type AppListResponse struct {
	Items []AppSummary `json:"items"`
	Page  AppListPage  `json:"page"`
	Meta  ResponseMeta `json:"meta"`
}

type CategoryChild struct {
	Key       string `json:"key"`
	Title     string `json:"title"`
	Position  *int   `json:"position,omitempty"`
	AppCount  int    `json:"appCount"`
	ParentKey string `json:"parentKey"`
}

type CategoryNode struct {
	Key      string          `json:"key"`
	Title    string          `json:"title"`
	Position *int            `json:"position,omitempty"`
	AppCount int             `json:"appCount"`
	Children []CategoryChild `json:"children"`
}

type CategoryTreeResponse struct {
	Items []CategoryNode `json:"items"`
	Meta  ResponseMeta   `json:"meta"`
}

type Screenshot struct {
	Key string `json:"key"`
	URL string `json:"url"`
}

type SourceDetail struct {
	Kind       string  `json:"kind"`
	Visibility string  `json:"visibility"`
	Author     *string `json:"author"`
	RecordID   *string `json:"recordId"`
}

type CategoryDetail struct {
	Primary   *CategoryRef  `json:"primary,omitempty"`
	Secondary []CategoryRef `json:"secondary"`
}

type LinkSet struct {
	Website string `json:"website,omitempty"`
	Docs    string `json:"docs,omitempty"`
	Github  string `json:"github,omitempty"`
}

type Requirements struct {
	VCpu      int `json:"vcpu,omitempty"`
	MemoryGB  int `json:"memoryGb,omitempty"`
	StorageGB int `json:"storageGb,omitempty"`
}

type TemplateDetail struct {
	Key       string `json:"key"`
	Source    string `json:"source"`
	Available bool   `json:"available"`
	PathHint  string `json:"pathHint,omitempty"`
}

type DeployDetail struct {
	Supported      bool   `json:"supported"`
	Mode           string `json:"mode"`
	SourceKind     string `json:"sourceKind"`
	DefaultAppName string `json:"defaultAppName"`
}

type PersonalizationDetail struct {
	IsFavorite bool    `json:"isFavorite"`
	Note       *string `json:"note"`
}

type InstalledAppSummary struct {
	Count int `json:"count"`
}

type AuditDetail struct {
	CreatedAt *string `json:"createdAt"`
	UpdatedAt *string `json:"updatedAt"`
}

type AppDetailResponse struct {
	Key             string                `json:"key"`
	Title           string                `json:"title"`
	Overview        string                `json:"overview"`
	Description     string                `json:"description,omitempty"`
	IconURL         string                `json:"iconUrl,omitempty"`
	Screenshots     []Screenshot          `json:"screenshots"`
	Source          SourceDetail          `json:"source"`
	Categories      CategoryDetail        `json:"categories"`
	Links           LinkSet               `json:"links"`
	Requirements    Requirements          `json:"requirements"`
	Template        TemplateDetail        `json:"template"`
	Deploy          DeployDetail          `json:"deploy"`
	Personalization PersonalizationDetail `json:"personalization"`
	Installed       *InstalledAppSummary  `json:"installed,omitempty"`
	Audit           AuditDetail           `json:"audit"`
}

type DeploySourceApp struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	Source string `json:"source"`
}

type InstallPrefill struct {
	PrefillMode    string `json:"prefillMode"`
	PrefillSource  string `json:"prefillSource"`
	PrefillAppKey  string `json:"prefillAppKey"`
	PrefillAppName string `json:"prefillAppName"`
}

type DeployCapabilities struct {
	HasComposeTemplate   bool `json:"hasComposeTemplate"`
	HasEnvTemplate       bool `json:"hasEnvTemplate"`
	SupportsDirectDeploy bool `json:"supportsDirectDeploy"`
}

type DeploySourceResponse struct {
	App          DeploySourceApp    `json:"app"`
	Template     TemplateSummary    `json:"template"`
	Install      InstallPrefill     `json:"install"`
	Capabilities DeployCapabilities `json:"capabilities"`
}

type PersonalizationRecord struct {
	AppKey     string  `json:"appKey"`
	IsFavorite bool    `json:"isFavorite"`
	Note       *string `json:"note"`
	CreatedAt  *string `json:"createdAt"`
	UpdatedAt  *string `json:"updatedAt"`
}

type PersonalizationListResponse struct {
	Items []PersonalizationRecord `json:"items"`
}

type CustomAppRecord struct {
	ID           string   `json:"id"`
	Key          string   `json:"key"`
	Trademark    string   `json:"trademark"`
	LogoURL      *string  `json:"logo_url"`
	Overview     string   `json:"overview"`
	Description  *string  `json:"description"`
	CategoryKeys []string `json:"category_keys"`
	ComposeYAML  string   `json:"compose_yaml"`
	EnvText      *string  `json:"env_text"`
	Visibility   string   `json:"visibility"`
	CreatedBy    string   `json:"created_by"`
	Created      string   `json:"created"`
	Updated      string   `json:"updated"`
}

type CustomAppUpsert struct {
	Key          string
	Trademark    string
	LogoURL      *string
	Overview     string
	Description  *string
	CategoryKeys []string
	ComposeYAML  string
	EnvText      *string
	Visibility   string
}

type Query struct {
	Locale            string
	PrimaryCategory   string
	SecondaryCategory string
	Search            string
	Source            string
	Visibility        string
	Favorite          *bool
	Limit             int
	Offset            int
}

type AdminSourceFileStatus struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Exists     bool   `json:"exists"`
	SizeBytes  int64  `json:"sizeBytes,omitempty"`
	ModifiedAt string `json:"modifiedAt,omitempty"`
}

type AdminLocaleStatus struct {
	Locale        string `json:"locale"`
	CategoryCount int    `json:"categoryCount"`
	ProductCount  int    `json:"productCount"`
	SourceVersion string `json:"sourceVersion,omitempty"`
}

type AdminSyncCapability struct {
	Available bool    `json:"available"`
	Reason    *string `json:"reason,omitempty"`
}

type AdminVersionMarkerStatus struct {
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
}

type AdminStatusResponse struct {
	RuntimeDir     string                   `json:"runtimeDir"`
	Files          []AdminSourceFileStatus  `json:"files"`
	Locales        []AdminLocaleStatus      `json:"locales"`
	VersionMarker  AdminVersionMarkerStatus `json:"versionMarker"`
	SyncCapability AdminSyncCapability      `json:"syncCapability"`
}

type AdminReindexResponse struct {
	Ok         bool                `json:"ok"`
	RuntimeDir string              `json:"runtimeDir"`
	Locales    []AdminLocaleStatus `json:"locales"`
}

type AdminRawCategoriesResponse struct {
	Items []SourceCategory `json:"items"`
	Meta  ResponseMeta     `json:"meta"`
}

type AdminRawAppResponse struct {
	Item SourceProduct `json:"item"`
	Meta ResponseMeta  `json:"meta"`
}
