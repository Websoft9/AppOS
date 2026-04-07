package instances

import "strings"

type SaveInput struct {
	Name         string
	Kind         string
	TemplateID   string
	Endpoint     string
	CredentialID string
	Config       map[string]any
	Description  string
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
	item, err := repo.New()
	if err != nil {
		return nil, err
	}
	if err := saveRecord(repo, item, input); err != nil {
		return nil, err
	}
	return item, nil
}

func UpdateExisting(repo Repository, existing *Instance, input SaveInput) (*Instance, error) {
	if err := saveRecord(repo, existing, input); err != nil {
		return nil, err
	}
	return existing, nil
}

func DeleteExisting(repo Repository, existing *Instance) error {
	return repo.Delete(existing)
}

func saveRecord(repo Repository, instance *Instance, input SaveInput) error {
	instance.ApplySaveInput(input)

	if err := applyTemplateConstraints(instance); err != nil {
		return err
	}

	return repo.RunInTransaction(func(txRepo Repository) error {
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

	if templateID != "" {
		template, ok := FindTemplate(templateID)
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
