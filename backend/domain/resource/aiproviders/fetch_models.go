package aiproviders

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var placeholderPattern = regexp.MustCompile(`\{([^}]+)\}`)

type FetchedModel struct {
	ID               string
	Vendor           string
	EnabledByDefault bool
}

type FetchModelsGroup struct {
	Vendor string
	Models []FetchedModel
}

type FetchModelsResponse struct {
	Models []FetchedModel
	Groups []FetchModelsGroup
}

type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

func FetchModels(ctx context.Context, endpoint string, apiKey string, templateID string, protocol string, client HTTPDoer) (FetchModelsResponse, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		return FetchModelsResponse{}, errors.New("endpoint is required")
	}

	modelsURL := strings.TrimRight(endpoint, "/") + "/models"
	useBearerAuth := false
	useQueryAPIKey := false
	useAnthropicHeaders := false
	var tpl Template
	var hasTemplate bool
	if templateID != "" {
		tpl, hasTemplate = FindTemplate(templateID)
		if protocolTpl, ok := findTemplateProtocol(tpl, protocol); ok && strings.TrimSpace(protocolTpl.ModelsEndpoint) != "" {
			modelsURL = resolveModelsEndpoint(endpoint, protocolTpl.ModelsEndpoint)
		} else if hasTemplate && tpl.ModelsEndpoint != "" {
			modelsURL = resolveModelsEndpoint(endpoint, tpl.ModelsEndpoint)
		}
	}
	normalizedProtocol := NormalizeProtocol(protocol)
	if normalizedProtocol == ProtocolAnthropic {
		useAnthropicHeaders = true
		modelsURL = strings.TrimRight(endpoint, "/") + "/models"
	} else if normalizedProtocol == ProtocolOllama {
		modelsURL = resolveModelsEndpoint(endpoint, "/api/tags")
	} else if isGoogleGeminiProvider(templateID, endpoint) {
		modelsURL = resolveGoogleGeminiModelsURL(endpoint)
		useBearerAuth = isGoogleGeminiOpenAIEndpoint(endpoint)
		useQueryAPIKey = !useBearerAuth
	} else if isAWSBedrockProvider(templateID, endpoint) {
		var resolveErr error
		modelsURL, resolveErr = resolveAWSBedrockModelsURL(endpoint)
		if resolveErr != nil {
			return FetchModelsResponse{}, resolveErr
		}
		useBearerAuth = true
	} else if apiKey != "" {
		useBearerAuth = true
	}

	if client == nil {
		if hasTemplate && tpl.SkipTLSCertVerify {
			client = &http.Client{
				Timeout: 8 * time.Second,
				Transport: &http.Transport{
					// #nosec G402 -- explicit template option for self-hosted providers with custom/self-signed certificates.
					TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
				},
			}
		} else {
			client = &http.Client{Timeout: 8 * time.Second}
		}
	}
	request, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL, nil)
	if reqErr != nil {
		return FetchModelsResponse{}, reqErr
	}
	request.Header.Set("Accept", "application/json")
	if useQueryAPIKey {
		if apiKey != "" {
			query := request.URL.Query()
			query.Set("key", apiKey)
			request.URL.RawQuery = query.Encode()
		}
	} else if useAnthropicHeaders {
		if apiKey != "" {
			request.Header.Set("x-api-key", apiKey)
		}
		request.Header.Set("anthropic-version", resolveAnthropicVersion(tpl))
	} else if useBearerAuth && apiKey != "" {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}

	response, doErr := client.Do(request)
	if doErr != nil {
		return FetchModelsResponse{}, doErr
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return FetchModelsResponse{}, errors.New("provider returned non-200: " + http.StatusText(response.StatusCode) + ": " + string(bodyBytes))
	}

	raw, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		return FetchModelsResponse{}, readErr
	}

	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return FetchModelsResponse{}, err
	}

	defaultEnabled := map[string]struct{}{}
	if hasTemplate {
		for _, model := range tpl.DefaultEnabledModels {
			trimmed := strings.TrimSpace(model)
			if trimmed != "" {
				defaultEnabled[trimmed] = struct{}{}
			}
		}
	}

	return buildFetchModelsResponse(parsed, defaultEnabled, templateID), nil
}

func findTemplateProtocol(template Template, protocol string) (TemplateProtocol, bool) {
	normalized := NormalizeProtocol(protocol)
	for _, item := range TemplateProtocols(template) {
		if NormalizeProtocol(item.ID) == normalized {
			return item, true
		}
	}
	return TemplateProtocol{}, false
}

func resolveAnthropicVersion(template Template) string {
	for _, field := range template.Fields {
		if strings.TrimSpace(field.ID) != "version" {
			continue
		}
		if value := strings.TrimSpace(fmt.Sprint(field.Default)); value != "" && value != "<nil>" {
			return value
		}
	}
	return "2023-06-01"
}

func buildFetchModelsResponse(parsed any, defaultEnabled map[string]struct{}, templateID string) FetchModelsResponse {
	models := collectFetchedModelItems(parsed, defaultEnabled, templateID)
	groups := make([]FetchModelsGroup, 0)
	if len(models) > 0 {
		grouped := map[string][]FetchedModel{}
		order := make([]string, 0)
		for _, model := range models {
			vendor := strings.TrimSpace(model.Vendor)
			if vendor == "" {
				vendor = "Other"
			}
			if _, ok := grouped[vendor]; !ok {
				order = append(order, vendor)
			}
			grouped[vendor] = append(grouped[vendor], model)
		}
		for _, vendor := range order {
			groups = append(groups, FetchModelsGroup{Vendor: vendor, Models: grouped[vendor]})
		}
	}
	return FetchModelsResponse{Models: models, Groups: groups}
}

func collectFetchedModelItems(parsed any, defaultEnabled map[string]struct{}, templateID string) []FetchedModel {
	items := make([]FetchedModel, 0)
	seen := map[string]struct{}{}
	appendItem := func(id string, vendor string, source map[string]any) {
		trimmedID := normalizeFetchedModelID(id)
		if trimmedID == "" {
			return
		}
		if isGoogleGeminiProvider(templateID, "") && !supportsGenerativeModel(source) {
			return
		}
		if isAWSBedrockProvider(templateID, "") && !supportsTextOutputModel(source) {
			return
		}
		if _, ok := seen[trimmedID]; ok {
			return
		}
		seen[trimmedID] = struct{}{}
		_, enabledByDefault := defaultEnabled[trimmedID]
		items = append(items, FetchedModel{
			ID:               trimmedID,
			Vendor:           strings.TrimSpace(vendor),
			EnabledByDefault: enabledByDefault,
		})
	}

	var visit func(any)
	visit = func(node any) {
		switch typed := node.(type) {
		case map[string]any:
			if id := firstMapString(typed, "id", "name", "model", "modelId", "modelName"); id != "" {
				appendItem(id, inferModelVendor(id, typed), typed)
			}
			for _, key := range []string{"data", "models", "items", "results", "modelSummaries"} {
				if next, ok := typed[key]; ok {
					visit(next)
				}
			}
		case []any:
			for _, item := range typed {
				visit(item)
			}
		}
	}
	visit(parsed)
	return items
}

func normalizeFetchedModelID(raw string) string {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimPrefix(trimmed, "models/")
	return strings.TrimSpace(trimmed)
}

func supportsGenerativeModel(source map[string]any) bool {
	raw, ok := source["supportedGenerationMethods"]
	if !ok {
		return true
	}
	methods, ok := raw.([]any)
	if !ok {
		return true
	}
	for _, method := range methods {
		name := strings.TrimSpace(fmt.Sprint(method))
		if name == "generateContent" || name == "streamGenerateContent" {
			return true
		}
	}
	return false
}

func supportsTextOutputModel(source map[string]any) bool {
	raw, ok := source["outputModalities"]
	if !ok {
		return true
	}
	modalities, ok := raw.([]any)
	if !ok {
		return true
	}
	for _, modality := range modalities {
		name := strings.TrimSpace(strings.ToUpper(fmt.Sprint(modality)))
		if name == "TEXT" {
			return true
		}
	}
	return false
}

func isGoogleGeminiProvider(templateID string, endpoint string) bool {
	if strings.EqualFold(strings.TrimSpace(templateID), "google-gemini") {
		return true
	}
	return strings.Contains(strings.ToLower(strings.TrimSpace(endpoint)), "generativelanguage.googleapis.com")
}

func isGoogleGeminiOpenAIEndpoint(endpoint string) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(endpoint)), "/openai")
}

func resolveGoogleGeminiModelsURL(endpoint string) string {
	base := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if isGoogleGeminiOpenAIEndpoint(base) {
		return base + "/models"
	}
	return resolveModelsEndpoint(base, "/models")
}

func isAWSBedrockProvider(templateID string, endpoint string) bool {
	if strings.EqualFold(strings.TrimSpace(templateID), "aws-bedrock") {
		return true
	}
	host := extractEndpointHostname(endpoint)
	return strings.HasPrefix(host, "bedrock-runtime.") || strings.HasPrefix(host, "bedrock-mantle.") || strings.HasPrefix(host, "bedrock.")
}

func resolveAWSBedrockModelsURL(endpoint string) (string, error) {
	host := extractEndpointHostname(endpoint)
	if strings.HasPrefix(host, "bedrock-mantle.") {
		return strings.TrimRight(endpoint, "/") + "/models", nil
	}
	region := extractAWSBedrockRegion(endpoint)
	if region == "" {
		return "", errors.New("could not determine AWS Bedrock region from endpoint")
	}
	return "https://bedrock." + region + ".amazonaws.com/foundation-models", nil
}

func extractEndpointHostname(rawEndpoint string) string {
	parsed, err := url.Parse(strings.TrimSpace(rawEndpoint))
	if err == nil && parsed.Hostname() != "" {
		return strings.ToLower(parsed.Hostname())
	}
	return strings.ToLower(strings.TrimSpace(rawEndpoint))
}

func extractAWSBedrockRegion(endpoint string) string {
	host := extractEndpointHostname(endpoint)
	for _, prefix := range []string{"bedrock-mantle.", "bedrock-runtime.", "bedrock."} {
		if strings.HasPrefix(host, prefix) {
			remainder := strings.TrimPrefix(host, prefix)
			parts := strings.Split(remainder, ".")
			if len(parts) > 0 {
				return strings.TrimSpace(parts[0])
			}
		}
	}
	return ""
}

func inferModelVendor(id string, source map[string]any) string {
	if vendor := firstMapString(source, "vendor", "provider", "providerName", "owned_by", "family"); vendor != "" {
		return humanizeVendor(vendor)
	}
	trimmedID := normalizeFetchedModelID(id)
	if strings.Contains(trimmedID, "/") {
		return humanizeVendor(strings.SplitN(trimmedID, "/", 2)[0])
	}
	return ""
}

func firstMapString(source map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := source[key]
		if !ok || value == nil {
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text != "" {
			return text
		}
	}
	return ""
}

func humanizeVendor(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parts := strings.FieldsFunc(strings.ReplaceAll(raw, "_", "-"), func(r rune) bool {
		return r == '-' || r == '/' || r == ':' || r == '.'
	})
	for index, part := range parts {
		if part == "" {
			continue
		}
		parts[index] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
	}
	return strings.Join(parts, " ")
}

func resolveModelsEndpoint(providerEndpoint, modelsEndpoint string) string {
	if strings.HasPrefix(modelsEndpoint, "http") {
		return modelsEndpoint
	}
	base := strings.TrimRight(providerEndpoint, "/")
	if strings.HasSuffix(base, "/v1") {
		base = strings.TrimRight(base, "/v1")
	}
	return strings.TrimRight(base, "/") + "/" + strings.TrimLeft(modelsEndpoint, "/")
}
