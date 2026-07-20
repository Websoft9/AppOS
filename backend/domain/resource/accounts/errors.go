package accounts

import (
	"fmt"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

type ValidationError = resourceshared.ValidationError

func newValidationError(message string, cause error) error {
	return resourceshared.NewValidationError(message, cause)
}

type ConflictError = resourceshared.ConflictError

func newConflictError(message string, cause error) error {
	return resourceshared.NewConflictError(message, cause)
}

type ReferencedByResourcesError struct {
	Cause error
}

func (e *ReferencedByResourcesError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("provider account is still referenced by resources: %v", e.Cause)
	}
	return "provider account is still referenced by resources"
}

func (e *ReferencedByResourcesError) Unwrap() error { return e.Cause }

func newReferencedByResourcesError(cause error) error {
	return &ReferencedByResourcesError{Cause: cause}
}

type AccessDeniedError = resourceshared.AccessDeniedError

type NotFoundError struct {
	ID    string
	Cause error
}

func (e *NotFoundError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("provider account %s not found: %v", e.ID, e.Cause)
	}
	return fmt.Sprintf("provider account %s not found", e.ID)
}

func (e *NotFoundError) Unwrap() error { return e.Cause }
