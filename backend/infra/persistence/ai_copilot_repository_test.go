package persistence

import (
	"context"
	"testing"

	"github.com/websoft9/appos/backend/domain/ai/copilot"
)

func TestAICopilotRepositoryPersistsSessionAndMessagesInOrder(t *testing.T) {
	app := newPersistenceTestApp(t)
	repo := NewAICopilotRepository(app)
	ctx := context.Background()

	session, err := repo.CreateSession(ctx, "owner-1", "Ops chat", "")
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if session.ID == "" || session.Title != "Ops chat" || session.OwnerID != "owner-1" {
		t.Fatalf("unexpected session: %+v", session)
	}

	if _, err := repo.AppendMessage(ctx, session.ID, copilot.RoleUser, "hello", "completed"); err != nil {
		t.Fatalf("AppendMessage user: %v", err)
	}
	if _, err := repo.AppendMessage(ctx, session.ID, copilot.RoleAssistant, "hi there", "completed"); err != nil {
		t.Fatalf("AppendMessage assistant: %v", err)
	}

	messages, err := repo.ListMessages(ctx, session.ID)
	if err != nil {
		t.Fatalf("ListMessages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(messages))
	}
	if messages[0].Role != copilot.RoleUser || messages[0].Content != "hello" {
		t.Fatalf("unexpected first message: %+v", messages[0])
	}
	if messages[1].Role != copilot.RoleAssistant || messages[1].Content != "hi there" {
		t.Fatalf("unexpected second message: %+v", messages[1])
	}

	if err := repo.TouchSession(ctx, session.ID, "hello"); err != nil {
		t.Fatalf("TouchSession: %v", err)
	}
	sessions, err := repo.ListSessions(ctx, "owner-1")
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 || sessions[0].Title != "hello" || sessions[0].LastMessageAt == "" {
		t.Fatalf("unexpected sessions: %+v", sessions)
	}
}
