package persistence

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
	"github.com/websoft9/appos/backend/domain/ai/chat"
	"github.com/websoft9/appos/backend/infra/collections"
)

type pocketBaseAIChatRepository struct {
	app core.App
}

func NewAIChatRepository(app core.App) chat.Repository {
	return &pocketBaseAIChatRepository{app: app}
}

func (r *pocketBaseAIChatRepository) CreateSession(_ context.Context, ownerID, title string) (*chat.Session, error) {
	collection, err := r.app.FindCollectionByNameOrId(collections.AIChatSessions)
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

func (r *pocketBaseAIChatRepository) ListSessions(_ context.Context, ownerID string) ([]*chat.Session, error) {
	records, err := r.app.FindRecordsByFilter(collections.AIChatSessions, "owner_id = {:ownerID}", "-last_message_at", 0, 0, map[string]any{"ownerID": ownerID})
	if err != nil {
		return nil, err
	}
	items := make([]*chat.Session, 0, len(records))
	for _, record := range records {
		items = append(items, sessionFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseAIChatRepository) GetSession(_ context.Context, sessionID, ownerID string) (*chat.Session, error) {
	record, err := r.findOwnedSessionRecord(sessionID, ownerID)
	if err != nil {
		return nil, err
	}
	return sessionFromRecord(record), nil
}

func (r *pocketBaseAIChatRepository) UpdateSession(_ context.Context, sessionID, ownerID, title string) (*chat.Session, error) {
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

func (r *pocketBaseAIChatRepository) DeleteSession(_ context.Context, sessionID, ownerID string) error {
	record, err := r.findOwnedSessionRecord(sessionID, ownerID)
	if err != nil {
		return err
	}
	return r.app.Delete(record)
}

func (r *pocketBaseAIChatRepository) ListMessages(_ context.Context, sessionID string) ([]*chat.Message, error) {
	records, err := r.app.FindRecordsByFilter(collections.AIChatMessages, "session = {:sessionID}", "created", 0, 0, map[string]any{"sessionID": sessionID})
	if err != nil {
		return nil, err
	}
	items := make([]*chat.Message, 0, len(records))
	for _, record := range records {
		items = append(items, messageFromRecord(record))
	}
	return items, nil
}

func (r *pocketBaseAIChatRepository) AppendMessage(_ context.Context, sessionID, role, content, status string) (*chat.Message, error) {
	collection, err := r.app.FindCollectionByNameOrId(collections.AIChatMessages)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	record.Set("session", sessionID)
	record.Set("role", chat.NormalizeRole(role))
	record.Set("content", content)
	record.Set("status", strings.TrimSpace(status))
	if err := r.app.Save(record); err != nil {
		return nil, err
	}
	return messageFromRecord(record), nil
}

func (r *pocketBaseAIChatRepository) TouchSession(_ context.Context, sessionID, title string) error {
	record, err := r.app.FindRecordById(collections.AIChatSessions, sessionID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(title) != "" {
		record.Set("title", strings.TrimSpace(title))
	}
	record.Set("last_message_at", time.Now().UTC().Format(time.RFC3339))
	return r.app.Save(record)
}

func (r *pocketBaseAIChatRepository) findOwnedSessionRecord(sessionID, ownerID string) (*core.Record, error) {
	records, err := r.app.FindRecordsByFilter(collections.AIChatSessions, "id = {:id} && owner_id = {:ownerID}", "", 1, 0, map[string]any{"id": sessionID, "ownerID": ownerID})
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, sql.ErrNoRows
	}
	return records[0], nil
}

func sessionFromRecord(record *core.Record) *chat.Session {
	return &chat.Session{
		ID:            record.Id,
		Title:         record.GetString("title"),
		OwnerID:       record.GetString("owner_id"),
		CreatedAt:     record.GetString("created"),
		UpdatedAt:     record.GetString("updated"),
		LastMessageAt: record.GetString("last_message_at"),
	}
}

func messageFromRecord(record *core.Record) *chat.Message {
	return &chat.Message{
		ID:        record.Id,
		SessionID: record.GetString("session"),
		Role:      record.GetString("role"),
		Content:   record.GetString("content"),
		Status:    record.GetString("status"),
		CreatedAt: record.GetString("created"),
	}
}
