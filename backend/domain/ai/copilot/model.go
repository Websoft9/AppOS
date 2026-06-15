package copilot

import "strings"

const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
)

type Session struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	OwnerID       string `json:"owner_id,omitempty"`
	CreatedAt     string `json:"created_at"`
	UpdatedAt     string `json:"updated_at"`
	LastMessageAt string `json:"last_message_at"`
}

type Message struct {
	ID        string `json:"id"`
	SessionID string `json:"session_id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	Status    string `json:"status,omitempty"`
	CreatedAt string `json:"created_at"`
}

type MessageAttachment struct {
	Name        string `json:"name"`
	MimeType    string `json:"mime_type,omitempty"`
	Size        int64  `json:"size,omitempty"`
	TextContent string `json:"text_content,omitempty"`
	RecordID    string `json:"record_id,omitempty"`
}

type ProviderConfig struct {
	Name                string
	Endpoint            string
	Model               string
	APIKey              string
	HTTPReferer         string
	MaxCompletionTokens *int
	ContextSize         int
}

func NormalizeRole(role string) string {
	switch strings.TrimSpace(strings.ToLower(role)) {
	case RoleSystem:
		return RoleSystem
	case RoleAssistant:
		return RoleAssistant
	default:
		return RoleUser
	}
}
