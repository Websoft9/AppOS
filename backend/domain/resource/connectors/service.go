package connectors

import (
	"fmt"
	"strings"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

type SaveInput struct {
	Name              string
	Kind              string
	IsEnabled         bool
	TemplateID        string
	Endpoint          string
	AuthScheme        string
	ProviderAccountID string
	CredentialID      string
	Config            map[string]any
	Description       string
}

type CredentialRefValidator = resourceshared.CredentialRefValidator

type ProviderAccountRefValidator = resourceshared.ProviderAccountRefValidator

type SaveDeps struct {
	ActorID                     string
	CredentialRefValidator      CredentialRefValidator
	ProviderAccountRefValidator ProviderAccountRefValidator
	TemplateResolver            func(templateID string) (Template, bool, error)
}

func List(repo Repository, kinds []string) ([]*Connector, error) {
	items, err := repo.List()
	if err != nil {
		return nil, err
	}
	if len(kinds) == 0 {
		return items, nil
	}

	allowed := make(map[string]struct{}, len(kinds))
	for _, kind := range kinds {
		trimmed := strings.TrimSpace(kind)
		if trimmed == "" {
			continue
		}
		allowed[trimmed] = struct{}{}
	}

	result := make([]*Connector, 0, len(items))
	for _, item := range items {
		if _, ok := allowed[item.Kind()]; ok {
			result = append(result, item)
		}
	}
	return result, nil
}

func Get(repo Repository, id string) (*Connector, error) {
	return repo.Get(id)
}

func Create(repo Repository, input SaveInput) (*Connector, error) {
	return CreateWithDeps(repo, input, SaveDeps{})
}

func CreateWithDeps(repo Repository, input SaveInput, deps SaveDeps) (*Connector, error) {
	item, err := repo.New()
	if err != nil {
		return nil, err
	}
	if err := saveRecord(repo, item, input, deps); err != nil {
		return nil, err
	}
	return item, nil
}

func Update(repo Repository, id string, input SaveInput) (*Connector, error) {
	item, err := repo.Get(id)
	if err != nil {
		return nil, err
	}
	return UpdateExistingWithDeps(repo, item, input, SaveDeps{})
}

// UpdateExisting applies input to a pre-fetched connector, avoiding a redundant
// Get when the caller already holds the record (e.g. for audit snapshots).
func UpdateExisting(repo Repository, existing *Connector, input SaveInput) (*Connector, error) {
	return UpdateExistingWithDeps(repo, existing, input, SaveDeps{})
}

func UpdateExistingWithDeps(repo Repository, existing *Connector, input SaveInput, deps SaveDeps) (*Connector, error) {
	if err := saveRecord(repo, existing, input, deps); err != nil {
		return nil, err
	}
	return existing, nil
}

func Delete(repo Repository, id string) error {
	item, err := repo.Get(id)
	if err != nil {
		return err
	}
	return repo.Delete(item)
}

// DeleteExisting deletes a pre-fetched connector, avoiding a redundant Get
// when the caller already holds the record.
func DeleteExisting(repo Repository, existing *Connector) error {
	return repo.Delete(existing)
}

func saveRecord(repo Repository, connector *Connector, input SaveInput, deps SaveDeps) error {
	connector.ApplySaveInput(input)

	if err := applyTemplateConstraints(connector, deps.TemplateResolver); err != nil {
		return err
	}

	return repo.RunInTransaction(func(txRepo Repository) error {
		if err := resourceshared.ValidateProviderAccountRef(connector.ProviderAccountID(), deps.ActorID, deps.ProviderAccountRefValidator); err != nil {
			return err
		}
		if err := resourceshared.ValidateCredentialRef(connector.CredentialID(), deps.ActorID, deps.CredentialRefValidator); err != nil {
			return err
		}
		exists, err := txRepo.ExistsByName(connector.Name(), connector.ID())
		if err != nil {
			return err
		}
		if exists {
			return newConflictError("connector name already exists", nil)
		}
		return txRepo.Save(connector)
	})
}

func applyTemplateConstraints(connector *Connector, templateResolver func(templateID string) (Template, bool, error)) error {
	kind := strings.TrimSpace(connector.Kind())
	name := strings.TrimSpace(connector.Name())
	templateID := NormalizeTemplateID(connector.TemplateID())
	authScheme := strings.TrimSpace(connector.AuthScheme())
	resolveTemplate := templateResolver
	if resolveTemplate == nil {
		resolveTemplate = FindTemplate
	}

	if name == "" {
		return newValidationError("name is required", nil)
	}

	if kind == "" {
		return newValidationError("kind is required", nil)
	}

	if !IsAllowedKind(kind) {
		return newValidationError(fmt.Sprintf("unsupported kind %q", kind), nil)
	}

	if templateID != "" {
		template, ok, err := resolveTemplate(templateID)
		if err != nil {
			return err
		}
		if !ok {
			return newValidationError(fmt.Sprintf("unknown template_id %q", templateID), nil)
		}
		if template.Kind != kind {
			return newValidationError(fmt.Sprintf("template %q has kind %q, not %q", templateID, template.Kind, kind), nil)
		}
		connector.SetTemplateID(template.ID)
		if authScheme == "" {
			connector.SetAuthScheme(template.DefaultAuth)
		}
		if strings.TrimSpace(connector.Endpoint()) == "" && strings.TrimSpace(template.DefaultEndpoint) != "" {
			connector.SetEndpoint(template.DefaultEndpoint)
		}
	}

	if strings.TrimSpace(connector.AuthScheme()) == "" {
		connector.SetAuthScheme(AuthSchemeNone)
	}

	connector.EnsureConfig()

	return nil
}
