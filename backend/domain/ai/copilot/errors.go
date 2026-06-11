package copilot

import "fmt"

const (
	CodeProviderSetupRequired = "ai_provider_setup_required"
	CodeProviderInvalid       = "ai_provider_invalid"
	CodeSessionNotFound       = "ai_copilot_session_not_found"
	CodeInvalidRequest        = "ai_copilot_invalid_request"
	CodeRuntimeFailed         = "ai_runtime_failed"
)

type CodedError struct {
	Code    string
	Message string
	Cause   error
}

func (e *CodedError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Cause)
	}
	return e.Message
}

func (e *CodedError) Unwrap() error { return e.Cause }

func coded(code, message string, cause error) *CodedError {
	return &CodedError{Code: code, Message: message, Cause: cause}
}
