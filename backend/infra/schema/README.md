# Schema

`backend/infra/schema` is the current source of truth for AppOS-owned table structure.

Rules:

- one table per file
- collection creation and field or index evolution land here directly
- app startup calls `EnsureAllCollections()` so structural changes self-apply
- `backend/infra/migrations` is reserved for the initial schema bootstrap, seed data, and true data migrations