package connectors

import (
	"fmt"

	resourceshared "github.com/websoft9/appos/backend/domain/resource/shared"
)

const (
	RuntimeReasonNoConnectorConfigured = "no_connector_configured"
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
