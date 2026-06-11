package persistence

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/ai/copilot"
	"github.com/websoft9/appos/backend/infra/collections"
)

type pocketBaseAICopilotRepository struct {
	app core.App
}

func NewAICopilotRepository(app core.App) copilot.Repository {
	return &pocketBaseAICopilotRepository{app: app}
}

func (r *pocketBaseAICopilotRepository) CreateSession(_ context.Context, ownerID, title string) (*copilot.Session, error) {
	collection, err := r.app.FindCollectionByNameOrId(collections.AICopilotSessions)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	now := time.Now().UTC().Format(time.RFC3339)
	record.Set("owner_id", ownerID)
	record.Set("title", strings.TrimSpace(title))
	record.Set("last_message_at", now)
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return sessionFromRecord(record), nil
}

func (r *pocketBaseAICopilotRepository) ListSessions(_ context.Context, ownerID string) ([]*copilot.Session, error) {
	records, err := r.app.FindRecordsByFilter(collections.AICopilotSessions, "owner_id = {:ownerID}", "-last_message_at", 0, 0, map[string]any{"ownerID": ownerID})
	if err != nil {
		return nil, err
	}
	items := make([]*copilot.Session, 0, len(records))
	for _, record := range records {
		items = append(items, sessionFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseAICopilotRepository) GetSession(_ context.Context, sessionID, ownerID string) (*copilot.Session, error) {
	record, err := r.findOwnedSessionRecord(sessionID, ownerID)
	if err != nil {
		return nil, err
	}
	return sessionFromRecord(record), nil
}

func (r *pocketBaseAICopilotRepository) UpdateSession(_ context.Context, sessionID, ownerID, title string) (*copilot.Session, error) {
	record, err := r.findOwnedSessionRecord(sessionID, ownerID)
	if err != nil {
		return nil, err
	}
	record.Set("title", strings.TrimSpace(title))
	record.Set("last_message_at", time.Now().UTC().Format(time.RFC3339))
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return sessionFromRecord(record), nil
}

func (r *pocketBaseAICopilotRepository) DeleteSession(_ context.Context, sessionID, ownerID string) error {
	record, err := r.findOwnedSessionRecord(sessionID, ownerID)
	if err != nil {
		return err
	}
	return r.app.Delete(record)
}

func (r *pocketBaseAICopilotRepository) ListMessages(_ context.Context, sessionID string) ([]*copilot.Message, error) {
	records, err := r.app.FindRecordsByFilter(collections.AICopilotMessages, "session = {:sessionID}", "created", 0, 0, map[string]any{"sessionID": sessionID})
	if err != nil {
		return nil, err
	}
	items := make([]*copilot.Message, 0, len(records))
	for _, record := range records {
		items = append(items, messageFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseAICopilotRepository) AppendMessage(_ context.Context, sessionID, role, content, status string) (*copilot.Message, error) {
	collection, err := r.app.FindCollectionByNameOrId(collections.AICopilotMessages)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	record.Set("session", sessionID)
	record.Set("role", copilot.NormalizeRole(role))
	record.Set("content", content)
	record.Set("status", strings.TrimSpace(status))
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return messageFromRecord(record), nil
}

func (r *pocketBaseAICopilotRepository) TouchSession(_ context.Context, sessionID, title string) error {
	record, err := r.app.FindRecordById(collections.AICopilotSessions, sessionID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(title) != "" {
		record.Set("title", strings.TrimSpace(title))
	}
	record.Set("last_message_at", time.Now().UTC().Format(time.RFC3339))
	return r.app.Save(record)
}

func (r *pocketBaseAICopilotRepository) findOwnedSessionRecord(sessionID, ownerID string) (*core.Record, error) {
	records, err := r.app.FindRecordsByFilter(collections.AICopilotSessions, "id = {:id} && owner_id = {:ownerID}", "", 1, 0, map[string]any{"id": sessionID, "ownerID": ownerID})
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, sql.ErrNoRows
	}
	return records[0], nil
}

func sessionFromRecord(record *core.Record) *copilot.Session {
	return &copilot.Session{
		ID:            record.Id,
		Title:         record.GetString("title"),
		OwnerID:       record.GetString("owner_id"),
		CreatedAt:     record.GetString("created"),
		UpdatedAt:     record.GetString("updated"),
		LastMessageAt: record.GetString("last_message_at"),
	}
}

func messageFromRecord(record *core.Record) *copilot.Message {
	return &copilot.Message{
		ID:        record.Id,
		SessionID: record.GetString("session"),
		Role:      record.GetString("role"),
		Content:   record.GetString("content"),
		Status:    record.GetString("status"),
		CreatedAt: record.GetString("created"),
	}
}
