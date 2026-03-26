package service

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/internal/deploy"
	"github.com/websoft9/appos/backend/internal/lifecycle/model"
	"github.com/websoft9/appos/backend/internal/secrets"
)

type ExposureIntent struct {
	ExposureType  string
	IsPrimary     bool
	Domain        string
	Path          string
	TargetPort    int
	CertificateID string
	Notes         string
}

func (intent *ExposureIntent) ToMap() map[string]any {
	if intent == nil {
		return nil
	}
	result := map[string]any{
		"exposure_type": intent.ExposureType,
		"is_primary":    intent.IsPrimary,
	}
	if intent.Domain != "" {
		result["domain"] = intent.Domain
	}
	if intent.Path != "" {
		result["path"] = intent.Path
	}
	if intent.TargetPort > 0 {
		result["target_port"] = intent.TargetPort
	}
	if intent.CertificateID != "" {
		result["certificate_id"] = intent.CertificateID
	}
	if intent.Notes != "" {
		result["notes"] = intent.Notes
	}
	return result
}

type NormalizedInstallSpec struct {
	ServerID           string
	ProjectName        string
	ComposeProjectName string
	ProjectDir         string
	RenderedCompose    string
	OperationType      string
	Source             string
	Adapter            string
	ResolvedEnv        map[string]any
	ExposureIntent     *ExposureIntent
	Metadata           map[string]any
	SecretRefs         []string
}

func (spec NormalizedInstallSpec) OperationSpec() map[string]any {
	result := map[string]any{
		"server_id":            spec.ServerID,
		"project_name":         spec.ProjectName,
		"source":               spec.Source,
		"adapter":              spec.Adapter,
		"compose_project_name": spec.ComposeProjectName,
		"project_dir":          spec.ProjectDir,
		"rendered_compose":     spec.RenderedCompose,
		"operation_type":       spec.OperationType,
	}
	if len(spec.ResolvedEnv) > 0 {
		result["resolved_env"] = spec.ResolvedEnv
	}
	if spec.ExposureIntent != nil {
		result["exposure_intent"] = spec.ExposureIntent.ToMap()
	}
	if len(spec.Metadata) > 0 {
		result["metadata"] = spec.Metadata
	}
	if len(spec.SecretRefs) > 0 {
		result["secret_refs"] = append([]string(nil), spec.SecretRefs...)
	}
	return result
}

type InstallResolutionRequest struct {
	ServerID           string
	ProjectName        string
	Compose            string
	OperationType      string
	Source             string
	Adapter            string
	ProjectDir         string
	ComposeProjectName string
	UserID             string
	Env                map[string]any
	ExposureIntent     *ExposureIntent
	Metadata           map[string]any
}

func ResolveInstallFromCompose(app core.App, request InstallResolutionRequest) (NormalizedInstallSpec, error) {
	if err := deploy.ValidateManualCompose(request.Compose); err != nil {
		return NormalizedInstallSpec{}, err
	}

	normalizedProjectName := deploy.NormalizeProjectName(request.ProjectName)
	if normalizedProjectName == "" {
		normalizedProjectName = "app"
	}
	composeProjectName := normalizedProjectName
	if value := strings.TrimSpace(request.ComposeProjectName); value != "" {
		composeProjectName = value
	}
	projectDir := filepath.Join("/appos/data/apps/operations", normalizedProjectName)
	if value := strings.TrimSpace(request.ProjectDir); value != "" {
		projectDir = value
	}
	operationType := strings.TrimSpace(request.OperationType)
	if operationType == "" {
		operationType = string(model.OperationTypeInstall)
	}
	resolvedEnv, secretRefs, err := normalizeInstallEnv(app, request.Env, request.UserID)
	if err != nil {
		return NormalizedInstallSpec{}, err
	}
	exposureIntent, err := normalizeExposureIntent(request.ExposureIntent)
	if err != nil {
		return NormalizedInstallSpec{}, err
	}
	return NormalizedInstallSpec{
		ServerID:           normalizeServerID(request.ServerID),
		ProjectName:        normalizedProjectName,
		ComposeProjectName: composeProjectName,
		ProjectDir:         projectDir,
		RenderedCompose:    request.Compose,
		OperationType:      operationType,
		Source:             request.Source,
		Adapter:            request.Adapter,
		ResolvedEnv:        resolvedEnv,
		ExposureIntent:     exposureIntent,
		Metadata:           cloneMap(request.Metadata),
		SecretRefs:         secretRefs,
	}, nil
}

func normalizeInstallEnv(app core.App, env map[string]any, userID string) (map[string]any, []string, error) {
	if len(env) == 0 {
		return nil, nil, nil
	}
	resolved := make(map[string]any, len(env))
	secretRefs := make([]string, 0)
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		normalizedKey := strings.TrimSpace(key)
		if normalizedKey == "" {
			return nil, nil, fmt.Errorf("env keys must not be empty")
		}
		value, err := normalizeEnvValue(app, env[key], userID)
		if err != nil {
			return nil, nil, fmt.Errorf("env %s: %w", normalizedKey, err)
		}
		resolved[normalizedKey] = value
		if stringValue, ok := value.(string); ok && secrets.IsSecretRef(stringValue) {
			secretRefs = append(secretRefs, stringValue)
		}
	}
	return resolved, secretRefs, nil
}

func normalizeEnvValue(app core.App, value any, userID string) (any, error) {
	switch typed := value.(type) {
	case nil:
		return "", nil
	case string:
		if secretID, ok := secrets.ExtractSecretID(typed); ok {
			if app == nil {
				return nil, fmt.Errorf("secret validation requires app context")
			}
			if err := secrets.ValidateRef(app, secretID, strings.TrimSpace(userID)); err != nil {
				return nil, err
			}
		}
		return typed, nil
	case bool:
		if typed {
			return "true", nil
		}
		return "false", nil
	case float64:
		return fmt.Sprintf("%v", typed), nil
	case float32:
		return fmt.Sprintf("%v", typed), nil
	case int:
		return fmt.Sprintf("%d", typed), nil
	case int32:
		return fmt.Sprintf("%d", typed), nil
	case int64:
		return fmt.Sprintf("%d", typed), nil
	default:
		return nil, fmt.Errorf("unsupported env value type %T", value)
	}
}

func normalizeExposureIntent(intent *ExposureIntent) (*ExposureIntent, error) {
	if intent == nil {
		return nil, nil
	}
	normalized := &ExposureIntent{
		ExposureType:  strings.TrimSpace(intent.ExposureType),
		IsPrimary:     intent.IsPrimary,
		Domain:        strings.TrimSpace(intent.Domain),
		Path:          strings.TrimSpace(intent.Path),
		TargetPort:    intent.TargetPort,
		CertificateID: strings.TrimSpace(intent.CertificateID),
		Notes:         strings.TrimSpace(intent.Notes),
	}
	if normalized.ExposureType == "" {
		switch {
		case normalized.Domain != "":
			normalized.ExposureType = "domain"
		case normalized.Path != "":
			normalized.ExposureType = "path"
		case normalized.TargetPort > 0:
			normalized.ExposureType = "port"
		default:
			return nil, nil
		}
	}
	if normalized.TargetPort < 0 {
		return nil, fmt.Errorf("target_port must be greater than or equal to zero")
	}
	switch normalized.ExposureType {
	case "domain":
		if normalized.Domain == "" {
			return nil, fmt.Errorf("domain exposure requires domain")
		}
	case "path":
		if normalized.Path == "" {
			return nil, fmt.Errorf("path exposure requires path")
		}
	case "port":
		if normalized.TargetPort <= 0 {
			return nil, fmt.Errorf("port exposure requires target_port")
		}
	case "internal_only":
	default:
		return nil, fmt.Errorf("unsupported exposure_type %q", normalized.ExposureType)
	}
	return normalized, nil
}

func normalizeServerID(serverID string) string {
	if strings.TrimSpace(serverID) == "" {
		return "local"
	}
	return strings.TrimSpace(serverID)
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	cloned := make(map[string]any, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}
