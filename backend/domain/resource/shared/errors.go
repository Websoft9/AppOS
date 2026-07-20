package shared

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

func NewValidationError(message string, cause error) error {
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

func NewConflictError(message string, cause error) error {
	return &ConflictError{Message: message, Cause: cause}
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
