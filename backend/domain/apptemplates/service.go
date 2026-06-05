package apptemplates

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/deploy"
	"github.com/websoft9/appos/backend/domain/secrets"
	"gopkg.in/yaml.v3"
)

var placeholderPattern = regexp.MustCompile(`\$\{([^}]+)\}`)

const defaultPlatformNetwork = "websoft9"

type Field struct {
	Key         string `json:"key"`
	Type        string `json:"type"`
	Label       string `json:"label"`
	Required    bool   `json:"required"`
	Default     any    `json:"default"`
	Visibility  string `json:"visibility"`
	StorageMode string `json:"storage_mode"`
	Options     []any  `json:"options,omitempty"`
}

type InputsSchema struct {
	Fields []Field `json:"fields"`
}

type Manifest struct {
	Key          string            `json:"key"`
	Name         string            `json:"name"`
	Trademark    string            `json:"trademark"`
	Category     string            `json:"category"`
	Docs         map[string]any    `json:"docs,omitempty"`
	Capabilities map[string]any    `json:"capabilities,omitempty"`
	Requirements map[string]any    `json:"requirements"`
	ServiceRoles map[string]string `json:"serviceRoles"`
}

type RenderSpec struct {
	Env           map[string]string  `json:"env"`
	ComposeValues map[string]any     `json:"compose_values"`
	Exposures     []TemplateExposure `json:"exposures"`
	Files         []any              `json:"files"`
}

type TemplateExposure struct {
	Label    string `json:"label"`
	Service  string `json:"service"`
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
	Default  bool   `json:"default,omitempty"`
}

type Source struct {
	TemplateRevision string `json:"template_revision"`
	OriginKind       string `json:"origin_kind"`
	OriginRef        string `json:"origin_ref"`
}

type Template struct {
	Manifest    Manifest
	Inputs      InputsSchema
	Render      RenderSpec
	Source      Source
	BaseCompose string
	RootDir     string
}

type RenderRequest struct {
	TemplateKey string
	ProjectName string
	Values      map[string]any
	UserID      string
}

type RenderedTemplate struct {
	TemplateKey     string
	ProjectName     string
	Compose         string
	ResolvedEnv     map[string]any
	SecretRefs      []string
	Metadata        map[string]any
	ExposureIntent  map[string]any
	RenderExposures []TemplateExposure
	Manifest        Manifest
}

type DescribeResponse struct {
	TemplateKey   string             `json:"templateKey"`
	Manifest      Manifest           `json:"manifest"`
	Inputs        []Field            `json:"inputs"`
	Source        Source             `json:"source"`
	Exposure      map[string]any     `json:"exposure,omitempty"`
	Exposures     []TemplateExposure `json:"exposures,omitempty"`
	ComposeValues map[string]any     `json:"composeValues,omitempty"`
}

type Service struct {
	roots []string
}

func NewService() *Service {
	return &Service{roots: defaultRoots()}
}

func defaultRoots() []string {
	roots := []string{}
	if cwd, err := os.Getwd(); err == nil {
		roots = append(roots, ancestorTemplateRoots(cwd)...)
	}
	if executable, err := os.Executable(); err == nil {
		roots = append(roots, ancestorTemplateRoots(filepath.Dir(executable))...)
	}
	roots = append(roots,
		"/appos/data/templates/apps",
		"/appos/data/templates/custom/apps",
		"/appos/data/templates/official/apps",
		"/appos/system/templates/official/apps",
		"/appos/library/templates/apps",
		"/appos/library/apps",
	)
	return uniqueStrings(roots)
}

func ancestorTemplateRoots(start string) []string {
	roots := []string{}
	current := start
	for {
		roots = append(roots, filepath.Join(current, "templates", "apps"))
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return roots
}

func (s *Service) Render(app core.App, request RenderRequest) (*RenderedTemplate, error) {
	projectName := deploy.NormalizeProjectName(request.ProjectName)
	if projectName == "" {
		return nil, errors.New("project_name is required")
	}
	tpl, err := s.loadTemplate(strings.TrimSpace(request.TemplateKey))
	if err != nil {
		return nil, err
	}
	values := buildInputValues(tpl.Inputs, request.Values)
	values["app_id"] = projectName
	for _, field := range tpl.Inputs.Fields {
		if !field.Required {
			continue
		}
		if strings.TrimSpace(stringify(values[field.Key])) == "" {
			return nil, fmt.Errorf("template input %s is required", field.Key)
		}
	}

	resolvedEnv, secretRefs, err := s.renderEnv(app, tpl.Render.Env, values, request.UserID)
	if err != nil {
		return nil, err
	}
	compose, err := renderCompose(tpl.BaseCompose, resolvedEnv)
	if err != nil {
		return nil, err
	}
	result := &RenderedTemplate{
		TemplateKey:     request.TemplateKey,
		ProjectName:     projectName,
		Compose:         compose,
		ResolvedEnv:     resolvedEnv,
		SecretRefs:      secretRefs,
		RenderExposures: cloneTemplateExposures(tpl.Render.Exposures),
		Manifest:        tpl.Manifest,
		ExposureIntent:  exposureIntentFromTemplateExposures(tpl.Render.Exposures),
		Metadata: map[string]any{
			"candidate_kind": "store-prefill",
			"prefill_context": map[string]any{
				"app_key":         tpl.Manifest.Key,
				"template_key":    tpl.Manifest.Key,
				"template_source": tpl.Source.OriginKind,
			},
			"template_context": map[string]any{
				"template_key":      tpl.Manifest.Key,
				"template_revision": tpl.Source.TemplateRevision,
				"origin_kind":       tpl.Source.OriginKind,
				"origin_ref":        tpl.Source.OriginRef,
				"exposures":         templateExposuresToMaps(tpl.Render.Exposures),
				"input_values":      values,
				"secret_refs":       secretRefs,
			},
		},
	}
	if disk := requirementBytes(tpl.Manifest.Requirements); disk > 0 {
		result.Metadata["app_required_disk_bytes"] = disk
	}
	return result, nil
}

func (s *Service) Describe(templateKey string) (*DescribeResponse, error) {
	tpl, err := s.loadTemplate(strings.TrimSpace(templateKey))
	if err != nil {
		return nil, err
	}
	return &DescribeResponse{
		TemplateKey:   tpl.Manifest.Key,
		Manifest:      tpl.Manifest,
		Inputs:        append([]Field(nil), tpl.Inputs.Fields...),
		Source:        tpl.Source,
		Exposure:      legacyExposureFromTemplateExposures(tpl.Render.Exposures),
		Exposures:     cloneTemplateExposures(tpl.Render.Exposures),
		ComposeValues: cloneAnyMap(tpl.Render.ComposeValues),
	}, nil
}

func (s *Service) loadTemplate(templateKey string) (*Template, error) {
	if templateKey == "" {
		return nil, errors.New("template_key is required")
	}
	for _, root := range s.roots {
		templateDir := filepath.Join(root, templateKey)
		if !isDir(templateDir) {
			continue
		}
		manifest := Manifest{}
		inputs := InputsSchema{}
		render := RenderSpec{}
		source := Source{}
		if err := readJSON(filepath.Join(templateDir, "manifest.json"), &manifest); err != nil {
			return nil, err
		}
		if err := readJSON(filepath.Join(templateDir, "inputs.schema.json"), &inputs); err != nil {
			return nil, err
		}
		if err := readJSON(filepath.Join(templateDir, "render.json"), &render); err != nil {
			return nil, err
		}
		if err := readJSON(filepath.Join(templateDir, "source.json"), &source); err != nil {
			return nil, err
		}
		composeBytes, err := os.ReadFile(filepath.Join(templateDir, "compose", "base.yml"))
		if err != nil {
			return nil, err
		}
		return &Template{Manifest: manifest, Inputs: inputs, Render: render, Source: source, BaseCompose: string(composeBytes), RootDir: templateDir}, nil
	}
	return nil, fmt.Errorf("template not found: %s", templateKey)
}

func buildInputValues(schema InputsSchema, overrides map[string]any) map[string]any {
	values := map[string]any{}
	for _, field := range schema.Fields {
		values[field.Key] = field.Default
	}
	for key, value := range overrides {
		values[key] = value
	}
	return values
}

func (s *Service) renderEnv(app core.App, spec map[string]string, values map[string]any, userID string) (map[string]any, []string, error) {
	keys := make([]string, 0, len(spec))
	for key := range spec {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	resolved := map[string]any{}
	secretRefs := []string{}
	for _, key := range keys {
		value, refs, err := s.resolveExpression(app, spec[key], values, userID)
		if err != nil {
			return nil, nil, fmt.Errorf("render env %s: %w", key, err)
		}
		resolved[key] = value
		secretRefs = append(secretRefs, refs...)
	}
	return resolved, uniqueStrings(secretRefs), nil
}

func (s *Service) resolveExpression(app core.App, expression string, values map[string]any, userID string) (string, []string, error) {
	secretRefs := []string{}
	resolved := placeholderPattern.ReplaceAllStringFunc(expression, func(raw string) string {
		token := strings.TrimSuffix(strings.TrimPrefix(raw, "${"), "}")
		switch {
		case strings.HasPrefix(token, "platform."):
			if token == "platform.network" {
				return defaultPlatformNetwork
			}
			secretRefs = append(secretRefs, "__error__:unsupported platform placeholder: "+token)
			return ""
		case strings.HasPrefix(token, "secret:"):
			inputKey := strings.TrimSpace(strings.TrimPrefix(token, "secret:"))
			ref, _ := values[inputKey].(string)
			if ref == "" {
				secretRefs = append(secretRefs, "__error__:missing secret input: "+inputKey)
				return ""
			}
			secretID, ok := secrets.ExtractSecretID(ref)
			if !ok {
				secretRefs = append(secretRefs, "__error__:invalid secret ref for input: "+inputKey)
				return ""
			}
			result, err := secrets.Resolve(app, secretID, userID)
			if err != nil {
				secretRefs = append(secretRefs, "__error__:"+err.Error())
				return ""
			}
			secretRefs = append(secretRefs, ref)
			return secrets.FirstStringFromPayload(result.Payload, "value", "password", "secret")
		default:
			if value, ok := values[token]; ok {
				return stringify(value)
			}
			secretRefs = append(secretRefs, "__error__:unknown input placeholder: "+token)
			return ""
		}
	})
	for _, item := range secretRefs {
		if strings.HasPrefix(item, "__error__:") {
			return "", nil, errors.New(strings.TrimPrefix(item, "__error__:"))
		}
	}
	return resolved, secretRefs, nil
}

func renderCompose(base string, resolvedEnv map[string]any) (string, error) {
	var node yaml.Node
	if err := yaml.Unmarshal([]byte(base), &node); err != nil {
		return "", fmt.Errorf("invalid compose yaml: %w", err)
	}
	if err := visitAndReplace(&node, func(value string) (string, bool, error) {
		if !strings.Contains(value, "${") {
			return value, false, nil
		}
		result := placeholderPattern.ReplaceAllStringFunc(value, func(raw string) string {
			token := strings.TrimSuffix(strings.TrimPrefix(raw, "${"), "}")
			if envValue, ok := resolvedEnv[token]; ok {
				return stringify(envValue)
			}
			return raw
		})
		if strings.Contains(result, "${") {
			return "", false, fmt.Errorf("unresolved compose placeholder in %q", value)
		}
		return result, true, nil
	}); err != nil {
		return "", err
	}
	encoded, err := yaml.Marshal(&node)
	if err != nil {
		return "", fmt.Errorf("marshal compose yaml: %w", err)
	}
	return string(encoded), nil
}

func visitAndReplace(node *yaml.Node, replace func(string) (string, bool, error)) error {
	if node == nil {
		return nil
	}
	if node.Kind == yaml.ScalarNode {
		updated, changed, err := replace(node.Value)
		if err != nil {
			return err
		}
		if changed {
			node.Value = updated
		}
	}
	for _, child := range node.Content {
		if err := visitAndReplace(child, replace); err != nil {
			return err
		}
	}
	return nil
}

func readJSON(path string, target any) error {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(bytes, target)
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func stringify(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func requirementBytes(requirements map[string]any) int64 {
	if requirements == nil {
		return 0
	}
	if value, ok := requirements["diskGb"]; ok {
		switch typed := value.(type) {
		case float64:
			return int64(typed * 1024 * 1024 * 1024)
		case int:
			return int64(typed) * 1024 * 1024 * 1024
		}
	}
	return 0
}

func exposureIntentFromTemplateExposures(exposures []TemplateExposure) map[string]any {
	for _, exposure := range exposures {
		if exposure.Default || len(exposures) == 1 {
			if exposure.Port <= 0 {
				return nil
			}
			return map[string]any{
				"exposure_type": "port",
				"is_primary":    true,
				"target_port":   exposure.Port,
			}
		}
	}
	return nil
}

func cloneTemplateExposures(input []TemplateExposure) []TemplateExposure {
	if len(input) == 0 {
		return nil
	}
	return append([]TemplateExposure(nil), input...)
}

func templateExposuresToMaps(input []TemplateExposure) []map[string]any {
	if len(input) == 0 {
		return nil
	}
	result := make([]map[string]any, 0, len(input))
	for _, exposure := range input {
		item := map[string]any{
			"label":    strings.TrimSpace(exposure.Label),
			"service":  strings.TrimSpace(exposure.Service),
			"port":     exposure.Port,
			"protocol": strings.TrimSpace(exposure.Protocol),
		}
		if exposure.Default {
			item["default"] = true
		}
		result = append(result, item)
	}
	return result
}

func legacyExposureFromTemplateExposures(exposures []TemplateExposure) map[string]any {
	for _, exposure := range exposures {
		if exposure.Default || len(exposures) == 1 {
			if exposure.Port <= 0 {
				return nil
			}
			kind := strings.TrimSpace(exposure.Protocol)
			if kind == "" {
				kind = "http"
			}
			return map[string]any{
				"kind":       kind,
				"service":    strings.TrimSpace(exposure.Service),
				"targetPort": exposure.Port,
			}
		}
	}
	return nil
}

func uniqueStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func cloneAnyMap(source map[string]any) map[string]any {
	if len(source) == 0 {
		return nil
	}
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
