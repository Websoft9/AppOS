package connectors

import (
	"fmt"
	"slices"
	"strings"
)

type SaveInput struct {
	Name         string
	Kind         string
	IsDefault    bool
	TemplateID   string
	Endpoint     string
	AuthScheme   string
	CredentialID string
	Config       map[string]any
	Description  string
}

func List(repo Repository, kinds []string) ([]*Connector, error) {
	items, err := repo.List()
	if err != nil {
		return nil, err
	}

	result := make([]*Connector, 0, len(items))
	for _, item := range items {
		if len(kinds) > 0 && !slices.Contains(kinds, item.Kind()) {
			continue
		}
		result = append(result, item)
	}
	return result, nil
}

func Get(repo Repository, id string) (*Connector, error) {
	return repo.Get(id)
}

func Create(repo Repository, input SaveInput) (*Connector, error) {
	item, err := repo.New()
	if err != nil {
		return nil, err
	}
	if err := saveRecord(repo, item, input); err != nil {
		return nil, err
	}
	return item, nil
}

func Update(repo Repository, id string, input SaveInput) (*Connector, error) {
	item, err := repo.Get(id)
	if err != nil {
		return nil, err
	}
	if err := saveRecord(repo, item, input); err != nil {
		return nil, err
	}
	return item, nil
}

// UpdateExisting applies input to a pre-fetched connector, avoiding a redundant
// Get when the caller already holds the record (e.g. for audit snapshots).
func UpdateExisting(repo Repository, existing *Connector, input SaveInput) (*Connector, error) {
	if err := saveRecord(repo, existing, input); err != nil {
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

func saveRecord(repo Repository, connector *Connector, input SaveInput) error {
	connector.ApplySaveInput(input)

	if err := applyTemplateConstraints(connector); err != nil {
		return err
	}

	return repo.RunInTransaction(func(txRepo Repository) error {
		if err := txRepo.Save(connector); err != nil {
			return err
		}
		if connector.IsDefault() {
			if err := txRepo.ClearDefaultsByKind(connector.Kind(), connector.ID()); err != nil {
				return err
			}
		}
		return nil
	})
}

func applyTemplateConstraints(connector *Connector) error {
	kind := strings.TrimSpace(connector.Kind())
	name := strings.TrimSpace(connector.Name())
	templateID := NormalizeTemplateID(connector.TemplateID())
	authScheme := strings.TrimSpace(connector.AuthScheme())

	if name == "" {
		return newValidationError("name is required", nil)
	}

	if kind == "" {
		return newValidationError("kind is required", nil)
	}

	if templateID != "" {
		template, ok := FindTemplate(templateID)
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
