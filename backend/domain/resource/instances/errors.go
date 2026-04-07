package instances

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
