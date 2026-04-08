package instances

import "strings"

type SaveInput struct {
	Name              string
	Kind              string
	TemplateID        string
	Endpoint          string
	ProviderAccountID string
	CredentialID      string
	Config            map[string]any
	Description       string
}

type CredentialRefValidator interface {
	ValidateCredentialRef(credentialID string, actorID string) error
}

type ProviderAccountRefValidator interface {
	ValidateProviderAccountRef(providerAccountID string, actorID string) error
}

type SaveDeps struct {
	ActorID                     string
	CredentialRefValidator      CredentialRefValidator
	ProviderAccountRefValidator ProviderAccountRefValidator
}

func List(repo Repository, kinds []string) ([]*Instance, error) {
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

	result := make([]*Instance, 0, len(items))
	for _, item := range items {
		if _, ok := allowed[item.Kind()]; ok {
			result = append(result, item)
		}
	}
	return result, nil
}

func Get(repo Repository, id string) (*Instance, error) {
	return repo.Get(id)
}

func Create(repo Repository, input SaveInput) (*Instance, error) {
	return CreateWithDeps(repo, input, SaveDeps{})
}

func CreateWithDeps(repo Repository, input SaveInput, deps SaveDeps) (*Instance, error) {
	item, err := repo.New()
	if err != nil {
		return nil, err
	}
	if err := saveRecord(repo, item, input, deps); err != nil {
		return nil, err
	}
	return item, nil
}

func UpdateExisting(repo Repository, existing *Instance, input SaveInput) (*Instance, error) {
	return UpdateExistingWithDeps(repo, existing, input, SaveDeps{})
}

func UpdateExistingWithDeps(repo Repository, existing *Instance, input SaveInput, deps SaveDeps) (*Instance, error) {
	if err := saveRecord(repo, existing, input, deps); err != nil {
		return nil, err
	}
	return existing, nil
}

func DeleteExisting(repo Repository, existing *Instance) error {
	return repo.Delete(existing)
}

func saveRecord(repo Repository, instance *Instance, input SaveInput, deps SaveDeps) error {
	instance.ApplySaveInput(input)

	if err := applyTemplateConstraints(instance); err != nil {
		return err
	}

	return repo.RunInTransaction(func(txRepo Repository) error {
		if err := validateProviderAccountRef(deps, instance.ProviderAccountID()); err != nil {
			return err
		}
		if err := validateCredentialRef(deps, instance.CredentialID()); err != nil {
			return err
		}
		exists, err := txRepo.ExistsByName(instance.Name(), instance.ID())
		if err != nil {
			return err
		}
		if exists {
			return newConflictError("instance name already exists", nil)
		}
		return txRepo.Save(instance)
	})
}

func applyTemplateConstraints(instance *Instance) error {
	name := strings.TrimSpace(instance.Name())
	kind := strings.TrimSpace(instance.Kind())
	templateID := NormalizeTemplateID(instance.TemplateID())

	if name == "" {
		return newValidationError("name is required", nil)
	}
	if kind == "" {
		return newValidationError("kind is required", nil)
	}
	if !IsAllowedKind(kind) {
		return newValidationError("unsupported kind \""+kind+"\"", nil)
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
		instance.SetTemplateID(template.ID)
		if strings.TrimSpace(instance.Endpoint()) == "" && strings.TrimSpace(template.DefaultEndpoint) != "" {
			instance.SetEndpoint(template.DefaultEndpoint)
		}
	}

	instance.EnsureConfig()
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

func validateProviderAccountRef(deps SaveDeps, providerAccountID string) error {
	trimmed := strings.TrimSpace(providerAccountID)
	if trimmed == "" {
		return nil
	}
	if deps.ProviderAccountRefValidator == nil {
		return newValidationError("provider account validation dependency is required when provider_account is set", nil)
	}
	if err := deps.ProviderAccountRefValidator.ValidateProviderAccountRef(trimmed, strings.TrimSpace(deps.ActorID)); err != nil {
		return err
	}
	return nil
}
