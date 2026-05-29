# Story 6.2: System Media Service

**Epic**: Epic 6 - Infra Modules  
**Status**: planned  
**Priority**: P1  
**Depends on**: Story 6.1 Files Service Foundation, Epic 1 DevOps

## Goal

Add one backend media service for Branding, avatar, and future uploaded images.

## Fixed Decisions

- media is a new backend capability; do not reuse `/api/assets`
- media files live under persisted runtime data at `/appos/data/media`
- first slice supports images only
- Branding is the first consumer
- Profile avatar is the next consumer, not a blocker for the first slice

## Layer Boundary

Reuse Story 6.1 as the substrate:

- `files-service` owns path safety and shared file operations
- `system-media` owns media metadata, validation, public/private access, and lifecycle

Rule:

- if a capability still makes sense without the word `image`, it belongs in `files-service`
- if a capability depends on image semantics or public asset delivery, it belongs in `system-media`

## Storage

- base path: `/appos/data/media`
- public files: `/appos/data/media/public/...`
- private files: `/appos/data/media/private/...`
- generated paths only; never trust client-supplied paths

## Record Model

Each media record must include:

- `id`
- `category` (`branding`, `avatar`, `general`)
- `scope` (`public`, `private`)
- `owner_type`
- `owner_id`
- `original_name`
- `content_type`
- `size`
- `storage_path`
- `public_url` for public media
- `created_by`
- `created`
- `updated`

## API

- `POST /api/media` upload one image and return metadata
- `GET /api/media/{id}` read metadata
- `DELETE /api/media/{id}` delete record and file
- `GET /api/media/{id}/content` authorized file read
- `GET /media/public/{...}` public file read

## Validation

Centralize in `system-media`:

- allowed MIME and extension whitelist
- size limit enforcement
- filename normalization
- category/scope validation

First-pass image types:

- `image/svg+xml`
- `image/png`
- `image/jpeg`
- `image/webp`
- `image/x-icon`

## Consumer Rules

Branding:

- logo and favicon upload through `system-media`
- settings store media URL or media id, not data URL
- `Use logo as favicon` stays in Branding logic, not media logic

Avatar:

- current PocketBase file-field flow stays working
- migration to `system-media` is a follow-on slice

## Acceptance Criteria

- [ ] media is specified as a separate backend capability from `assets`
- [ ] `/appos/data/media` is the canonical persisted media root
- [ ] the document explicitly states that Story 6.1 is reused for path safety and file operations only
- [ ] the document explicitly states that media metadata, validation, public/private access, and lifecycle remain in `system-media`
- [ ] the metadata model is fixed for the first slice
- [ ] the API surface is fixed for the first slice
- [ ] Branding is the first implementation consumer
- [ ] Avatar is documented as the next consumer, not a prerequisite

## Dev Tasks

- [ ] create media collection/model
- [ ] implement persisted storage under `/appos/data/media`
- [ ] implement upload, metadata read, content read, and delete routes
- [ ] implement public file route for public media
- [ ] implement image validation and generated-path writing
- [ ] migrate Branding logo/favicon upload to `system-media`
- [ ] leave avatar migration to a separate follow-on change

## Guardrails

- do not duplicate path-safety logic outside Story 6.1
- do not store persistent data URLs once media exists
- do not expose internal filesystem paths as public URLs
- do not force all historical upload surfaces to migrate in the first slice