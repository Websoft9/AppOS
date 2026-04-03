package llm

// SettingsModule is the module key used in the custom_settings table.
const SettingsModule = "llm"

// ProvidersSettingsKey is the key under the llm module in custom_settings.
const ProvidersSettingsKey = "providers"

// Provider represents a single LLM provider configuration.
type Provider struct {
	Name     string `json:"name"`
	Endpoint string `json:"endpoint"`
	ApiKey   string `json:"apiKey"`
}

// DefaultProviders returns the default (empty) provider list used for seeding.
func DefaultProviders() map[string]any {
	return map[string]any{"items": []any{}}
}
