# Story 31.1: Chat MVP

**Epic**: Epic 31 - AI Runtime
**Status**: review | **Priority**: P1 | **Depends on**: AI Providers, Secrets, Settings

## Objective

Deliver the smallest useful AppOS AI Runtime slice by adding a DeepSeek-backed, persisted, multi-turn chat experience powered by Eino in the Go backend.

This story validates the runtime foundation before AppOS introduces operational tools, context packs, workflow drafts, or autonomous agent behavior.

## Product Positioning

This story is a foundation slice, not the full AppOS agent experience.

It proves that AppOS can:

- use an AI Provider record as the model configuration source
- keep model credentials server-side through existing Secret references
- run model calls through an Eino-backed Go runtime layer
- support continuous chat sessions in the web UI
- stream assistant output without exposing provider keys to the browser
- persist message history so refresh and return visits preserve conversation context

The first user-facing experience should feel like a minimal AI console, not a broad AI cockpit.

## Scope

- add an AI Runtime backend package for chat-oriented model execution
- use Eino as the Go AI framework for the first runtime adapter
- support DeepSeek through the existing OpenAI-compatible provider shape
- reuse existing AI Provider and Secret records rather than introducing a separate provider configuration store
- add persisted chat session and message storage
- expose authenticated AppOS API routes for session list, session messages, and sending a message
- stream assistant responses to the frontend, preferably with SSE or an equivalent AppOS-consistent streaming pattern
- add a minimal frontend chat surface with session selection, message history, text input, pending state, and streaming assistant output
- keep the implementation compatible with future tool-using operational agents

## Out of Scope

- tool calling
- ReAct or multi-agent behavior
- RAG or document indexing
- workflow draft generation
- deployment or lifecycle action execution
- terminal access from AI
- model provider auto-failover
- user-editable prompts or skills
- long-term AI memory beyond persisted chat messages
- a full AI cockpit navigation redesign

## Backend Contract

Suggested route family:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ai/chat/sessions` | List current operator-visible chat sessions |
| POST | `/api/ai/chat/sessions` | Create a new chat session |
| GET | `/api/ai/chat/sessions/{sessionId}/messages` | List persisted messages for one session |
| POST | `/api/ai/chat/sessions/{sessionId}/messages` | Send one user message and stream the assistant response |

Implementation may collapse the first slice into fewer routes if it keeps the API authenticated, persisted, and easy to extend.

Request body for sending a message should include at minimum:

```json
{
  "message": "Explain why my deployment failed"
}
```

The backend owns:

- session identity
- message persistence
- role ordering
- provider credential lookup
- model call construction
- streaming response framing
- final assistant message persistence

The browser must never receive provider API keys or Secret plaintext.

## Data Contract

Minimum chat session fields:

- `id`
- `title`
- `created_at`
- `updated_at`
- `last_message_at`

Minimum chat message fields:

- `id`
- `session_id`
- `role` (`user`, `assistant`, `system` if needed later)
- `content`
- `created_at`
- optional `status` (`pending`, `complete`, `failed`) if useful for streaming failure recovery

The first slice may generate session titles from the first user message or use a static fallback such as `New chat`.

## Provider and Model Rules

- DeepSeek should be consumed as an OpenAI-compatible chat model.
- The runtime should prefer the default AI Provider selected in Settings when present.
- If no default provider exists, the API should return a clear setup-required error rather than silently using a hard-coded key.
- If the selected provider lacks a credential, endpoint, or model, the API should return a validation error that points the operator to AI Provider configuration.
- The implementation may support an environment-only development fallback only if it does not bypass production AI Provider behavior.

## Eino Integration Rules

- Introduce Eino behind an AppOS-owned AI Runtime service interface rather than calling it directly from route handlers.
- Keep provider resolution, secret resolution, Eino model construction, and chat execution in separate units so future providers and agent tools can be added without rewriting routes.
- Do not make Eino the owner of AppOS lifecycle workflows, deployment state, or domain mutations.
- Do not expose Eino demo server routes directly to the frontend.

Suggested backend package boundary:

- `backend/domain/ai/runtime` or `backend/domain/ai/chat` for runtime application logic
- `backend/domain/routes/ai_chat.go` for route registration and request/response mapping
- `backend/infra/persistence` for session/message repositories if PocketBase persistence is used

Exact package names may follow local conventions discovered during implementation.

## Frontend Contract

Add the smallest authenticated chat surface that supports:

- viewing existing chat sessions
- creating a new session
- selecting a session
- rendering user and assistant messages in chronological order
- sending a message
- showing assistant output incrementally while streaming
- showing loading and error states
- preserving session messages after refresh

The first UI should be functional and quiet. It should not introduce a marketing-style AI cockpit or broad dashboard redesign.

Suggested location options:

- a new authenticated `AI` route if the app shell already has a suitable navigation pattern
- a superuser-only experimental route if product navigation is not ready

The implementation should keep route placement small and reversible.

## Security and Policy

- All routes require authenticated AppOS access.
- Superuser-only gating is acceptable for the MVP and preferred if user-level AI permissions are not defined yet.
- Secret plaintext must remain server-side.
- Chat content should be treated as operator data and stored only in AppOS persistence.
- Do not allow the model to execute tools, shell commands, deployments, or file writes in this story.
- Add audit records for session creation and message send if the existing audit model can do so without excessive scope; otherwise document the audit gap for the next AI Runtime story.

## UX Requirements

- Text input remains usable while a session is selected.
- Sending an empty message is disabled.
- While streaming, the current assistant message updates in place rather than adding many separate rows.
- Errors are visible and do not erase the user message.
- Refreshing the page reloads sessions and messages from the backend.
- The UI works in light and dark themes.
- The UI remains readable on desktop and tablet-sized layouts; mobile polish can stay minimal for this MVP.

## Acceptance Criteria

1. AppOS has a backend AI chat route family that requires authentication.
2. The backend resolves the model from the existing AI Provider system instead of exposing provider credentials to the frontend.
3. DeepSeek can be configured and used through the existing OpenAI-compatible provider shape.
4. The backend integrates Eino behind an AppOS-owned runtime service boundary.
5. A user can create or open a chat session from the frontend.
6. A user can send at least three consecutive messages in one session and receive context-aware assistant replies.
7. Assistant output streams incrementally to the frontend or otherwise provides a clearly progressive response experience.
8. User and assistant messages are persisted and reload after page refresh.
9. If no usable AI Provider is configured, the UI shows a setup-required error and no provider key is requested in the browser.
10. The MVP does not expose tool calling, shell execution, deployment actions, or workflow mutation to the model.
11. Backend tests cover provider validation, authentication, message persistence, and successful chat execution through a mocked model boundary.
12. Frontend tests cover session load, message send, streaming or progressive update state, empty input guard, and provider setup error state.

## Tasks / Subtasks

- [x] Task 1: Define AI chat persistence
  - [x] 1.1 add chat session storage with owner/superuser visibility appropriate for the MVP
  - [x] 1.2 add chat message storage with role, content, session reference, and timestamps
  - [x] 1.3 add repository tests for session/message ordering and persistence
- [x] Task 2: Add AppOS AI Runtime chat service
  - [x] 2.1 resolve default AI Provider and credential through existing domain services
  - [x] 2.2 map DeepSeek/OpenAI-compatible provider config into an Eino chat model
  - [x] 2.3 keep Eino calls behind a mockable runtime interface
  - [x] 2.4 build multi-turn request context from persisted session messages
- [x] Task 3: Add authenticated chat routes
  - [x] 3.1 list/create sessions
  - [x] 3.2 list messages for a session
  - [x] 3.3 send message and stream/progressively return assistant response
  - [x] 3.4 persist both user message and final assistant response
  - [x] 3.5 return setup-required and provider-validation errors with stable codes
- [x] Task 4: Add minimal frontend chat surface
  - [x] 4.1 session list and new-session action
  - [x] 4.2 message history rendering
  - [x] 4.3 input composer and send action
  - [x] 4.4 streaming/progressive assistant message rendering
  - [x] 4.5 loading, empty, and error states
- [x] Task 5: Validation
  - [x] 5.1 backend route/service tests with mocked model execution
  - [x] 5.2 frontend component or route tests for the MVP chat flow
  - [x] 5.3 run focused backend and frontend test targets documented by the implementation

## Guardrails

- Do not introduce a Node/TypeScript AI sidecar.
- Do not make DeepSeek credentials a frontend concern.
- Do not bypass existing AI Provider and Secret ownership for production behavior.
- Do not add tool execution or operational mutations in this MVP.
- Do not let the AI Runtime mutate deployment, software, terminal, monitoring, or resource domains directly.
- Keep the story as a foundation for future context-based agents, not as the final agent product.

## Future Follow-ups

- add AppOS context packs for selected servers, apps, deployments, and logs
- add read-only diagnostic tools
- add workflow draft generation with explicit human approval
- add audit-first agent run records separate from generic chat sessions
- add stop/retry/regenerate controls
- add model/provider picker if product requirements call for it

## Dev Agent Record

### Agent Model Used

GitHub Copilot

### Debug Log References

- Focused backend tests: `go test ./domain/ai/chat ./infra/persistence ./infra/migrations ./domain/routes`
- Full backend tests: `go test ./...`
- Frontend AI chat tests: `npm run test -- -t AIChatPage`
- Frontend build: `npm run build`

### Completion Notes

- Added PocketBase-backed `ai_chat_sessions` and `ai_chat_messages` collections with superuser-only API access for the MVP.
- Added an AppOS-owned chat service boundary that resolves the default LLM AI Provider, decrypts server-side Secrets, maps OpenAI-compatible config into Eino, and keeps model execution mockable.
- Added SSE chat send route that persists user and final assistant messages while streaming assistant chunks to the browser.
- Added a minimal authenticated AI Chat frontend route with session selection, new session creation, persisted message loading, progressive assistant rendering, empty-send guard, and visible errors.
- Added backend repository/route tests and frontend route tests for the MVP flow.
- Audit records for chat events are not included in this slice; capture dedicated AI run/audit records in the next AI Runtime story.

### File List

- `backend/domain/ai/chat/errors.go`
- `backend/domain/ai/chat/eino_model.go`
- `backend/domain/ai/chat/model.go`
- `backend/domain/ai/chat/provider.go`
- `backend/domain/ai/chat/service.go`
- `backend/domain/routes/ai_chat.go`
- `backend/domain/routes/ai_chat_test.go`
- `backend/domain/routes/routes.go`
- `backend/docs/openapi/ext-api.yaml`
- `backend/go.mod`
- `backend/go.sum`
- `backend/infra/collections/names.go`
- `backend/infra/migrations/1767200000_ai_chat.go`
- `backend/infra/persistence/ai_chat_repository.go`
- `backend/infra/persistence/ai_chat_repository_test.go`
- `backend/infra/persistence/test_fixture_test.go`
- `web/src/components/layout/Sidebar.tsx`
- `web/src/lib/ai-chat-api.ts`
- `web/src/routeTree.gen.ts`
- `web/src/routes/_app/_auth/-ai-chat.test.tsx`
- `web/src/routes/_app/_auth/ai-chat.tsx`

### Change Log

- 2026-05-31: Implemented Story 31.1 Chat MVP and moved story to review.