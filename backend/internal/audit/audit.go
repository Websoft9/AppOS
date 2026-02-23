// Package audit provides a unified helper for writing operation audit records.
//
// All backend writes go through Write(); access rules on the audit_logs collection
// prevent any client-side mutations.
package audit

import (
	"log"

	"github.com/pocketbase/pocketbase/core"
)

const (
	StatusPending = "pending"
	StatusSuccess = "success"
	StatusFailed  = "failed"
)

var validStatuses = map[string]bool{
	StatusPending: true,
	StatusSuccess: true,
	StatusFailed:  true,
}

// Entry holds all fields for a single audit record.
// Using a named struct avoids the swap-bug risk of 7 consecutive string parameters.
type Entry struct {
	// UserID is the PocketBase record ID of the actor (use "unknown" for unauthenticated failures).
	UserID string
	// UserEmail is the actor's email address for display purposes.
	UserEmail string
	// Action is a dot-namespaced verb, e.g. "app.restart", "login.failed".
	Action string
	// ResourceType is the category of the affected resource, e.g. "app", "user", "session".
	ResourceType string
	// ResourceID is the PocketBase record ID or unique key of the affected resource.
	ResourceID string
	// ResourceName is the human-readable label of the affected resource.
	ResourceName string
	// Status must be one of StatusPending, StatusSuccess, or StatusFailed.
	Status string
	// IP is the client's source IP address (from RealIP / trusted proxy headers).
	// Empty for operations originating from async workers (no HTTP context).
	IP string
	// UserAgent is the HTTP User-Agent header value.
	// Stored automatically inside the detail JSON — no separate DB column needed.
	UserAgent string
	// Detail holds optional structured context (error message, task ID, etc.).
	// UserAgent is merged in automatically when non-empty.
	Detail map[string]any
}

// Write persists one audit record to the audit_logs collection.
// It bypasses PocketBase access rules via app.Save(), so it works from any
// backend handler or Asynq worker.
// Errors are logged and swallowed — an audit failure must never break the
// calling operation.
func Write(app core.App, entry Entry) {
	if !validStatuses[entry.Status] {
		log.Printf("audit.Write: invalid status %q for action %q — skipping", entry.Status, entry.Action)
		return
	}

	col, err := app.FindCollectionByNameOrId("audit_logs")
	if err != nil {
		log.Printf("audit.Write: collection not found: %v", err)
		return
	}

	rec := core.NewRecord(col)
	rec.Set("user_id", entry.UserID)
	rec.Set("user_email", entry.UserEmail)
	rec.Set("action", entry.Action)
	rec.Set("resource_type", entry.ResourceType)
	rec.Set("resource_id", entry.ResourceID)
	rec.Set("resource_name", entry.ResourceName)
	rec.Set("status", entry.Status)
	rec.Set("ip", entry.IP)

	// Merge UserAgent into detail so it doesn't need its own DB column,
	// but is still accessible for display in the audit viewer.
	detail := entry.Detail
	if entry.UserAgent != "" {
		if detail == nil {
			detail = map[string]any{}
		}
		detail["user_agent"] = entry.UserAgent
	}
	if detail != nil {
		rec.Set("detail", detail)
	}

	if err := app.Save(rec); err != nil {
		log.Printf("audit.Write: save failed: %v", err)
	}
}
