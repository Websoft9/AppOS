package instances

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

type AccessDeniedError = resourceshared.AccessDeniedError

type NotFoundError struct {
	ID    string
	Cause error
}

func (e *NotFoundError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("instance %s not found: %v", e.ID, e.Cause)
	}
	return fmt.Sprintf("instance %s not found", e.ID)
}

func (e *NotFoundError) Unwrap() error { return e.Cause }
