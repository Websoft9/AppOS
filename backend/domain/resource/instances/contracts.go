package instances

import (
	instanceruntime "github.com/websoft9/appos/backend/domain/resource/instances/runtime"
	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

const (
	CapabilityCredentialProbeRedis = instanceruntime.CapabilityCredentialProbeRedis
)

type KindContract = instanceruntime.KindContract

func KindContracts() []KindContract {
	return instanceruntime.KindContracts()
}

func FindKindContract(kind string) (KindContract, bool) {
	return instanceruntime.FindKindContract(kind)
}

func ResolveTraits(item *Instance) ([]string, error) {
	if item == nil {
		return nil, nil
	}
	return instanceruntime.ResolveTraits(item.Kind(), item.TemplateID(), func(templateID string) ([]string, error) {
		template, ok, err := FindTemplate(templateID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, nil
		}
		return resourceshared.CloneStrings(template.Traits), nil
	})
}

func HasTrait(item *Instance, expected string) (bool, error) {
	return HasAllTraits(item, expected)
}

func HasAllTraits(item *Instance, expected ...string) (bool, error) {
	traits, err := ResolveTraits(item)
	if err != nil {
		return false, err
	}
	required := resourceshared.NormalizeStringList(expected)
	if len(required) == 0 {
		return false, nil
	}
	for _, trait := range required {
		if !resourceshared.ContainsString(traits, trait) {
			return false, nil
		}
	}
	return true, nil
}

func ResolveCapabilities(item *Instance) ([]string, error) {
	traits, err := ResolveTraits(item)
	if err != nil {
		return nil, err
	}
	return instanceruntime.ResolveCapabilitiesFromTraits(traits), nil
}

func HasCapability(item *Instance, expected string) (bool, error) {
	return HasAllCapabilities(item, expected)
}

func HasAllCapabilities(item *Instance, expected ...string) (bool, error) {
	capabilities, err := ResolveCapabilities(item)
	if err != nil {
		return false, err
	}
	required := resourceshared.NormalizeStringList(expected)
	if len(required) == 0 {
		return false, nil
	}
	for _, capability := range required {
		if !resourceshared.ContainsString(capabilities, capability) {
			return false, nil
		}
	}
	return true, nil
}
