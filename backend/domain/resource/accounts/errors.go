package accounts

import "fmt"

type ValidationError struct {
	Message string
	Cause   error
}

func (e *ValidationError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

func (e *ValidationError) Unwrap() error { return e.Cause }

func newValidationError(message string, cause error) error {
	return &ValidationError{Message: message, Cause: cause}
}

type ConflictError struct {
	Message string
	Cause   error
}

func (e *ConflictError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

func (e *ConflictError) Unwrap() error { return e.Cause }

func newConflictError(message string, cause error) error {
	return &ConflictError{Message: message, Cause: cause}
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

type AccessDeniedError struct {
	Message string
	Cause   error
}

func (e *AccessDeniedError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

func (e *AccessDeniedError) Unwrap() error { return e.Cause }

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
