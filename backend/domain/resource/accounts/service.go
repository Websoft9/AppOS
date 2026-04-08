package accounts

import "strings"

type SaveInput struct {
	Name         string
	Kind         string
	TemplateID   string
	Identifier   string
	CredentialID string
	Config       map[string]any
	Description  string
}

type CredentialRefValidator interface {
	ValidateCredentialRef(credentialID string, actorID string) error
}

type SaveDeps struct {
	ActorID                string
	CredentialRefValidator CredentialRefValidator
}

func List(repo Repository, kinds []string) ([]*ProviderAccount, error) {
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

	result := make([]*ProviderAccount, 0, len(items))
	for _, item := range items {
		if _, ok := allowed[item.Kind()]; ok {
			result = append(result, item)
		}
	}
	return result, nil
}

func Get(repo Repository, id string) (*ProviderAccount, error) {
	return repo.Get(id)
}

func Create(repo Repository, input SaveInput) (*ProviderAccount, error) {
	return CreateWithDeps(repo, input, SaveDeps{})
}

func CreateWithDeps(repo Repository, input SaveInput, deps SaveDeps) (*ProviderAccount, error) {
	item, err := repo.New()
	if err != nil {
		return nil, err
	}
	if err := saveRecord(repo, item, input, deps); err != nil {
		return nil, err
	}
	return item, nil
}

func UpdateExisting(repo Repository, existing *ProviderAccount, input SaveInput) (*ProviderAccount, error) {
	return UpdateExistingWithDeps(repo, existing, input, SaveDeps{})
}

func UpdateExistingWithDeps(repo Repository, existing *ProviderAccount, input SaveInput, deps SaveDeps) (*ProviderAccount, error) {
	if err := saveRecord(repo, existing, input, deps); err != nil {
		return nil, err
	}
	return existing, nil
}

func DeleteExisting(repo Repository, existing *ProviderAccount) error {
	return repo.RunInTransaction(func(txRepo Repository) error {
		hasReferences, err := txRepo.HasReferences(existing.ID())
		if err != nil {
			return err
		}
		if hasReferences {
			return newReferencedByResourcesError(nil)
		}
		return txRepo.Delete(existing)
	})
}

func saveRecord(repo Repository, account *ProviderAccount, input SaveInput, deps SaveDeps) error {
	account.ApplySaveInput(input)

	if err := applyTemplateConstraints(account); err != nil {
		return err
	}

	return repo.RunInTransaction(func(txRepo Repository) error {
		if err := validateCredentialRef(deps, account.CredentialID()); err != nil {
			return err
		}
		exists, err := txRepo.ExistsByName(account.Name(), account.ID())
		if err != nil {
			return err
		}
		if exists {
			return newConflictError("provider account name already exists", nil)
		}
		return txRepo.Save(account)
	})
}

func applyTemplateConstraints(account *ProviderAccount) error {
	name := strings.TrimSpace(account.Name())
	kind := strings.TrimSpace(account.Kind())
	templateID := NormalizeTemplateID(account.TemplateID())

	if name == "" {
		return newValidationError("name is required", nil)
	}
	if kind == "" {
		return newValidationError("kind is required", nil)
	}
	if !IsAllowedKind(kind) {
		return newValidationError("unsupported kind \""+kind+"\"", nil)
	}
	if strings.TrimSpace(account.Identifier()) == "" {
		return newValidationError("identifier is required", nil)
	}

	if templateID != "" {
		template, ok, err := FindTemplate(templateID)
		if err != nil {
			return err
		}
		if !ok {
			return newValidationError("unknown template_id \""+templateID+"\"", nil)
		}
		if template.Kind != kind {
			return newValidationError("template \""+templateID+"\" has kind \""+template.Kind+"\", not \""+kind+"\"", nil)
		}
		account.SetTemplateID(template.ID)
	}

	account.EnsureConfig()
	return nil
}

func validateCredentialRef(deps SaveDeps, credentialID string) error {
	trimmed := strings.TrimSpace(credentialID)
	if trimmed == "" {
		return nil
	}
	if deps.CredentialRefValidator == nil {
		return newValidationError("credential validation dependency is required when credential is set", nil)
	}
	if err := deps.CredentialRefValidator.ValidateCredentialRef(trimmed, strings.TrimSpace(deps.ActorID)); err != nil {
		return err
	}
	return nil
}
