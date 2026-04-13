package aiproviders

import (
	"fmt"
	"strings"

	"github.com/websoft9/appos/backend/domain/resource/connectors"
)

type SaveInput = connectors.SaveInput
type CredentialRefValidator = connectors.CredentialRefValidator
type ProviderAccountRefValidator = connectors.ProviderAccountRefValidator
type SaveDeps = connectors.SaveDeps

func List(repo Repository) ([]*AIProvider, error) {
	return connectors.List(repo, []string{KindLLM})
}

func Get(repo Repository, id string) (*AIProvider, error) {
	item, err := connectors.Get(repo, id)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(item.Kind()) != KindLLM {
		return nil, &NotFoundError{ID: id}
	}
	return item, nil
}

func Create(repo Repository, input SaveInput) (*AIProvider, error) {
	return CreateWithDeps(repo, input, SaveDeps{})
}

func CreateWithDeps(repo Repository, input SaveInput, deps SaveDeps) (*AIProvider, error) {
	normalized, err := normalizeSaveInput(input)
	if err != nil {
		return nil, err
	}
	return connectors.CreateWithDeps(repo, normalized, deps)
}

func Update(repo Repository, id string, input SaveInput) (*AIProvider, error) {
	item, err := Get(repo, id)
	if err != nil {
		return nil, err
	}
	return UpdateExistingWithDeps(repo, item, input, SaveDeps{})
}

func UpdateExisting(repo Repository, existing *AIProvider, input SaveInput) (*AIProvider, error) {
	return UpdateExistingWithDeps(repo, existing, input, SaveDeps{})
}

func UpdateExistingWithDeps(repo Repository, existing *AIProvider, input SaveInput, deps SaveDeps) (*AIProvider, error) {
	normalized, err := normalizeSaveInput(input)
	if err != nil {
		return nil, err
	}
	return connectors.UpdateExistingWithDeps(repo, existing, normalized, deps)
}

func Delete(repo Repository, id string) error {
	item, err := Get(repo, id)
	if err != nil {
		return err
	}
	return DeleteExisting(repo, item)
}

func DeleteExisting(repo Repository, existing *AIProvider) error {
	return connectors.DeleteExisting(repo, existing)
}

func normalizeSaveInput(input SaveInput) (SaveInput, error) {
	input.Kind = strings.TrimSpace(input.Kind)
	if input.Kind == "" {
		input.Kind = KindLLM
	}
	if input.Kind != KindLLM {
		return SaveInput{}, &ValidationError{Message: fmt.Sprintf("unsupported kind %q", input.Kind)}
	}
	if templateID := connectors.NormalizeTemplateID(input.TemplateID); templateID != "" {
		template, ok := FindTemplate(templateID)
		if !ok {
			return SaveInput{}, &ValidationError{Message: fmt.Sprintf("unknown template_id %q", templateID)}
		}
		if template.Kind != KindLLM {
			return SaveInput{}, &ValidationError{Message: fmt.Sprintf("template %q has kind %q, not %q", templateID, template.Kind, KindLLM)}
		}
		input.TemplateID = template.ID
	}
	return input, nil
}
