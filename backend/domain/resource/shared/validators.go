package shared

import "strings"

type CredentialRefValidator interface {
	ValidateCredentialRef(credentialID string, actorID string) error
}

type ProviderAccountRefValidator interface {
	ValidateProviderAccountRef(providerAccountID string, actorID string) error
}

func ValidateCredentialRef(credentialID string, actorID string, validator CredentialRefValidator) error {
	trimmed := strings.TrimSpace(credentialID)
	if trimmed == "" {
		return nil
	}
	if validator == nil {
		return NewValidationError("credential validation dependency is required when credential is set", nil)
	}
	return validator.ValidateCredentialRef(trimmed, strings.TrimSpace(actorID))
}

func ValidateProviderAccountRef(providerAccountID string, actorID string, validator ProviderAccountRefValidator) error {
	trimmed := strings.TrimSpace(providerAccountID)
	if trimmed == "" {
		return nil
	}
	if validator == nil {
		return NewValidationError("provider account validation dependency is required when provider_account is set", nil)
	}
	return validator.ValidateProviderAccountRef(trimmed, strings.TrimSpace(actorID))
}
