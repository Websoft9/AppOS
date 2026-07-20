package aiproviders

import (
	"fmt"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

type ValidationError = resourceshared.ValidationError
type ConflictError = resourceshared.ConflictError
type AccessDeniedError = resourceshared.AccessDeniedError

type NotFoundError struct {
	ID    string
	Cause error
}

func (e *NotFoundError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("AI provider %s not found: %v", e.ID, e.Cause)
	}
	return fmt.Sprintf("AI provider %s not found", e.ID)
}

func (e *NotFoundError) Unwrap() error { return e.Cause }
