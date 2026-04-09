# Story 27.1 / 27.2: Feeds Backend Technical Direction

Status: proposed

## Objective

Turn `27.1 Feed Source Registry` and the backend slice of `27.2 Feed Item Ingestion and Query` into an implementation-ready direction.

The goal is to validate the Feeds subdomain with the smallest backend that can stand on its own:

- stable source registry
- deterministic ingestion path
- normalized item storage with dedupe
- queryable signal records

No frontend IA expansion is required in this slice.

## Design Judgment

Do not start with a full reader, complex scheduling model, or custom CRUD API.

Start with:

1. PocketBase native collections for `feed_sources` and `feed_items`
2. one backend ingestion service that can fetch one source deterministically
3. one platform polling job that scans due sources
4. native records query for initial list/filter needs

This keeps the first validation on domain shape, not on UI or orchestration complexity.

## Recommended Boundary

### `Feeds` owns

- source identity
- source polling policy
- feed item normalization
- feed item dedupe identity
- extracted keywords and tags
- item review state

### `Feeds` does not own

- generic connector credential management
- full article rendering
- notification workflow
- app actions triggered from feed changes

## Minimal Data Model Direction

### `feed_sources`

Back with PocketBase `BaseCollection`.

Required fields:

1. `name`
2. `url`
3. `format`
4. `status`
5. `poll_interval_minutes`
6. `last_fetched_at`
7. `last_success_at`
8. `last_error`
9. `created`
10. `updated`

Notes:

- `url` must be unique.
- `format` stays explicit as `rss | atom` even if auto-detection is later added.
- `last_error` is a short operator-facing diagnostic summary, not a structured event log replacement.

### `feed_items`

Back with PocketBase `BaseCollection`.

Required fields:

1. `source_id`
2. `external_id`
3. `title`
4. `link`
5. `published_at`
6. `summary`
7. `keywords_json`
8. `tags_json`
9. `state`
10. `created`
11. `updated`

Notes:

- Use `keywords_json` and `tags_json` as storage names to make clear they are serialized value payloads.
- Backend must decode these fields defensively because PocketBase JSON values may arrive in different shapes.
- `source_id + external_id` is the dedupe key and must be unique.

## Why Not Per-Source Cron Jobs

Do not create one native cron job per source.

Use one platform-managed polling job that:

1. lists active sources
2. decides whether each source is due based on `poll_interval_minutes` and `last_fetched_at`
3. fetches due sources one by one
4. updates `last_fetched_at`, `last_success_at`, and `last_error`

This avoids turning source records into scheduler definitions and keeps poll policy inside the Feeds domain.

## Ingestion Path

### Step 1: Source fetch service

Create one backend service that accepts a `feed_source` record and returns normalized candidate items.

Service responsibilities:

1. fetch remote content
2. parse RSS or Atom
3. normalize source entry identity
4. normalize title, link, published time, and summary
5. extract keywords and tags

### Step 2: Dedupe and save

For each normalized candidate item:

1. compute `external_id`
2. upsert or insert by `source_id + external_id`
3. preserve existing item state if the item already exists

Rule:

- ingestion may refresh content fields, but must not overwrite operator-owned review state unnecessarily

### Step 3: Poll coordinator

Create one coordinator that scans due sources and calls the fetch service.

Keep this coordinator serial in MVP.

Reason:

- easier failure semantics
- easier rate-limit handling
- easier testability

Parallel fetching can wait until source count proves it necessary.

## Extraction Rule

Keyword and tag extraction should stay intentionally weak in MVP.

Allowed first pass:

1. tokenize title
2. tokenize summary if available
3. normalize lowercase and dedupe
4. map a few obvious terms to tags such as `release`, `security`, `breaking-change`, `maintenance`

Do not add LLM dependence or heavy NLP in the first backend slice.

## Query Contract

Use PocketBase native records API first.

Initial query needs:

1. by source
2. by state
3. by published time

Tag and keyword query can follow one of two paths:

1. native JSON/text filtering if it is good enough in practice
2. one thin read endpoint later if native query semantics become too weak

Do not pre-introduce a custom query endpoint before the native records path proves insufficient.

## Suggested Package / File Direction

### Migrations

Add migrations under `backend/infra/migrations/` for:

1. `feed_sources`
2. `feed_items`

Follow the same PocketBase `BaseCollection` pattern already used by `groups` and `audit_logs`.

### Domain package

Create a narrow backend package, suggested name:

`backend/domain/feeds`

Suggested contents:

1. source record helpers
2. fetch / parse service
3. item normalization
4. tag extraction
5. polling coordinator

Keep route shaping and persistence call sites thin.

### Poll registration

Register one AppOS-managed polling job through the existing platform task path rather than inventing a second scheduler model.

Implementation target can be either:

1. PocketBase native cron registration
2. an existing AppOS background execution registry if one becomes the standardized place

Current recommendation:

- use one native cron-style job because the workload is periodic and independent from request/response flows
- do not use Asynq first for periodic polling; Asynq is already valuable for queued user-triggered work, but Feeds polling is time-driven rather than request-driven

## Failure Policy

Failure to fetch one source must not abort the whole polling pass.

Per-source behavior:

1. set `last_fetched_at`
2. update `last_success_at` only on success
3. store short `last_error` on failure
4. continue with the next due source

Do not create a dedicated run-history collection in MVP.

## Test Direction

Minimum backend test coverage:

1. migration creates collections and unique indexes
2. one RSS source parses into normalized candidate items
3. dedupe prevents duplicate `source_id + external_id`
4. existing item review `state` is preserved across re-ingestion
5. paused or archived sources are skipped by the polling coordinator

## Delivery Plan

### Slice A: Registry foundation

1. create `feed_sources` migration
2. verify PocketBase native CRUD contract
3. no custom routes

### Slice B: Item foundation

1. create `feed_items` migration
2. add normalization and dedupe service
3. add parser fixtures and tests

### Slice C: Polling loop

1. add one platform polling job
2. scan due sources serially
3. update source status fields

### Slice D: Query proving

1. validate native record query is enough for source/state/time filters
2. defer custom read endpoint unless a real query gap appears