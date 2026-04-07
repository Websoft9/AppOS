package connectors

import "fmt"

const (
	RuntimeReasonNoConnectorConfigured = "no_connector_configured"
	RuntimeReasonMultipleDefaults      = "multiple_defaults"
	RuntimeReasonDefaultRequired       = "default_required"
)

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
		return fmt.Sprintf("connector %s not found: %v", e.ID, e.Cause)
	}
	return fmt.Sprintf("connector %s not found", e.ID)
}

func (e *NotFoundError) Unwrap() error { return e.Cause }

type RuntimeConfigError struct {
	Kind   string
	Reason string
	Cause  error
}

func (e *RuntimeConfigError) Error() string {
	message := fmt.Sprintf("connector runtime error for %s: %s", e.Kind, e.Reason)
	if e.Cause != nil {
		return message + ": " + e.Cause.Error()
	}
	return message
}

func (e *RuntimeConfigError) Unwrap() error { return e.Cause }

func IsRuntimeReason(err error, reason string) bool {
	runtimeErr, ok := err.(*RuntimeConfigError)
	return ok && runtimeErr.Reason == reason
}
