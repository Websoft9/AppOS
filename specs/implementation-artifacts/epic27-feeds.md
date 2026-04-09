# Epic 27: Feeds

**Module**: Operations Management / Feeds | **Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 18, Epic 21, Epic 22

## Objective

Introduce `Feeds` as a subdomain for external signal intake and operator judgment.

`Feeds` is not a general RSS reader. It exists so operators can query, filter, judge, and relate external updates to apps and operational knowledge.

## Scope

In scope:

- feed source management
- scheduled RSS / Atom ingestion
- normalized feed item storage
- keyword / tag extraction
- operator query and judgment workflow
- binding feed items to apps and topics

Out of scope:

- full article reading experience
- generic content subscription product
- recommendation algorithm
- notification automation beyond simple future hooks

## DDD Position

`Feeds` is a supporting subdomain under `Operations Management`.

- `Integrations` owns transport and connector mechanics only.
- `Feeds` owns the business meaning of external signals after ingestion.
- `Topics` remains the collaboration and discussion object; `Feeds` may attach or publish into it but does not replace it.
- `Application Lifecycle` may consume feed signals as context, but does not own feed identity.

## User Goal

The user comes here to answer one question:

`Does this external update matter to my apps or operations, and what should I do with it?`

## Core Model

### Aggregates

| Aggregate | Root | Boundary | Invariants |
| --- | --- | --- | --- |
| Feed Source | `FeedSource` | One subscribed external feed | source URL, type, polling policy, and status stay coherent together |
| Feed Item | `FeedItem` | One normalized external entry from one source | one item belongs to exactly one source and must keep stable dedupe identity |
| Feed Judgment | `FeedJudgment` | One operator decision over one feed item in one local context | one judgment belongs to one item and one target context |

### Entities / Value Objects

- `FeedTag`: extracted label such as `release`, `security`, `breaking-change`, `maintenance`
- `FeedBinding`: relation from one item to one local object such as `app` or `topic`
- `SourceSchedule`: polling cadence and fetch policy
- `ItemFingerprint`: normalized dedupe key from source item identity

## Boundaries

`Feeds` owns:

- source registration
- item normalization
- dedupe
- tagging / keyword extraction
- operator judgment state
- app / topic binding

`Feeds` does not own:

- raw connector credential storage
- topic conversation threads
- app upgrade execution
- incident workflow

## Minimal States

### Feed Source

`active` -> `paused` -> `archived`

### Feed Item

`ingested` -> `reviewed` -> `dismissed` or `bound`

### Feed Judgment

`none` -> `relevant` or `ignore` or `watch`

## Minimal Data Shape

### `feed_sources`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | Text | required |
| `url` | URL | required, unique |
| `format` | Text | `rss` or `atom` |
| `status` | Text | `active` \| `paused` \| `archived` |
| `poll_interval_minutes` | Number | required |
| `last_fetched_at` | DateTime | optional |

### `feed_items`

| Field | Type | Notes |
| --- | --- | --- |
| `source_id` | Relation -> `feed_sources` | required |
| `external_id` | Text | source entry id or normalized link |
| `title` | Text | required |
| `link` | URL | required |
| `published_at` | DateTime | optional |
| `summary` | Text | optional, plain text only |
| `keywords` | JSON | extracted keyword list |
| `tags` | JSON | extracted tag list |
| `state` | Text | `ingested` \| `reviewed` \| `dismissed` \| `bound` |

Unique meaning: `source_id + external_id`

### `feed_judgments`

| Field | Type | Notes |
| --- | --- | --- |
| `item_id` | Relation -> `feed_items` | required |
| `target_type` | Text | `app` \| `topic` |
| `target_id` | Text | required |
| `decision` | Text | `relevant` \| `ignore` \| `watch` |
| `note` | Text | optional |

Unique meaning: `item_id + target_type + target_id`

## Product Surface

Independent page is required.

- Navigation: `Collaboration -> Feeds`
- Default view: list of ingested items with source, tags, time, and current judgment
- Primary actions: filter, inspect, mark relevance, bind to app, bind to topic
- Reading stays external: item click opens original link

## Story Shape

### Story 27.1 Feed Source Registry

Create `feed_sources` management and polling baseline.

See `story27.1-feed-source-registry.md`.

### Story 27.2 Feed Item Ingestion and Query

Create normalized `feed_items`, dedupe, extraction, and the first Feeds page.

See `story27.2-feed-item-ingestion-and-query.md`.

### Story 27.3 Judgment and Binding

Allow users to mark relevance and bind items to apps or topics.

See `story27.3-judgment-and-binding.md`.

## Recommended Delivery Order

1. `27.1` source registry and collection setup
2. `27.2` ingestion pipeline, dedupe, and first query page
3. `27.3` judgment and binding workflow

Backend-first technical direction:

- See `story27.1-27.2-feeds-backend-technical-direction.md`.

Implementation note:

- Backend order should be `collections -> polling job -> normalization -> query page -> judgment actions`.
- Frontend should wait until `feed_sources` and `feed_items` query contracts are stable.
- No automation or notification side effects should be added before judgment is working end to end.

## Acceptance Criteria

- Users can create, pause, and archive feed sources.
- System ingests RSS / Atom entries into normalized feed items with dedupe.
- Users can query items by source, tag, keyword, and time.
- Users can mark an item as `relevant`, `ignore`, or `watch`.
- Users can bind an item to an app or a topic.
- The page remains a signal workbench, not a full reading product.