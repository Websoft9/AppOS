# Migrations Rules

This folder contains the small AppOS PocketBase migration set that remains after the schema-first MVP cleanup.

## Core Rule

- `backend/infra/schema` is the source of truth for current collection structure.
- Field, index, relation, and rule changes belong in schema files, not in standalone structural migrations.
- `backend/infra/migrations` should stay intentionally small.

## What Belongs Here

- one versioned release migration file for the current MVP release window
- that file may contain the schema bootstrap plus the small set of idempotent seeds needed by fresh installs

## What Does Not Belong Here

- long-lived structural patch migrations
- broad legacy compatibility backfills kept "just in case"
- per-field or per-index schema history for MVP

## Practical Rule

When considering a new migration:

1. If it changes collection structure, update `backend/infra/schema` instead.
2. If it inserts default records needed by a fresh install, add it to the current release migration file.
3. If it only exists for an old upgrade path that MVP no longer promises, delete it.
4. Use a zero-padded semver filename such as `v03.06.00_initial.go`. A new release that needs migration work creates a new file; old files are never renamed after release.