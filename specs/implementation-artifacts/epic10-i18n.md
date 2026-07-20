# Epic 10: Internationalization (i18n)

**Module**: Internationalization | **Status**: Backlog / In Progress by slice | **Priority**: P2 | **Depends on**: Epic 7

## Overview

Epic 10 standardizes how AppOS presents product language across the Dashboard UI.

This epic does **not** introduce runtime translation management, remote locale delivery, or per-tenant language configuration. Phase 1 remains intentionally simple:

- bundled frontend locale files
- `react-i18next` / `i18next`
- English and Chinese only
- user-selected locale persisted in `localStorage`

The goal is operational consistency, not i18n platform complexity.

## Current Baseline

The frontend already has a working i18n foundation:

- bootstrap entry in `web/src/lib/i18n.ts`
- locale storage key `ws9-locale`
- locale files under `web/src/locales/{en,zh}`
- existing namespaces: `common`, `store`, `aiChat`

Epic 10 owns turning that foundation into a coherent, repo-wide convention.

## Design Principle

AppOS does **not** organize locale files strictly by page.

The organization rule is:

- use `common` for cross-module reusable UI text
- use **domain-like namespaces** for stable business terminology that spans multiple screens
- use **feature namespaces** for self-contained frontend interaction flows

In short:

**Business nouns align to domain boundaries; page-flow copy aligns to frontend feature boundaries.**

This matters because AppOS backend is DDD-driven, while the frontend often composes multiple domains into one user flow.

## What This Epic Owns

Epic 10 is responsible for:

- the namespace strategy
- translation file layout and naming rules
- locale persistence and language switching behavior
- migration of hardcoded UI strings into namespaces
- locale-aware formatting for dates, times, relative times, and similar UI output
- consistency rules for shared terms

Epic 10 is **not** responsible for:

- backend message localization
- translating LLM/model output
- tenant-specific localization settings
- remote translation delivery infrastructure

## File Layout Contract

Frontend locale files live here:

```text
web/src/locales/
	en/
		common.json
		store.json
		aiChat.json
		...
	zh/
		common.json
		store.json
		aiChat.json
		...
```

`web/src/lib/i18n.ts` is the registration point for all namespaces.

## Namespace Strategy

### 1. `common`

Use `common` only for text that is genuinely cross-module and low-risk to share.

Examples:

- save / cancel / delete / retry
- loading / error / empty
- back / next / previous
- confirm / close / edit

Do **not** move domain-specific nouns into `common` just because they appear in more than one page.

### 2. Domain-like namespaces

Use a domain-like namespace when the text represents a stable business vocabulary and is likely to be reused across multiple routes or surfaces.

Good fits in AppOS:

- `resources`
- `secrets`
- `groups`
- `topics`
- `feeds`
- `space`
- `audit`

These namespaces should favor terminology consistency with backend domain language.

### 3. Feature namespaces

Use a feature namespace when the text is dominated by a single frontend interaction flow or product surface.

Good fits in AppOS:

- `aiChat`
- `store`
- `deploy`
- `terminal`
- `settings`
- `navigation` or `sidebar`

These namespaces may still use domain terms, but their primary boundary is UI ownership and maintenance locality.

## Recommended Namespace Map

| Namespace | Primary Driver | Frontend Surface | Backend Alignment | Notes |
|---|---|---|---|---|
| `common` | Shared UI | all routes | n/a | actions, generic states, confirmations |
| `aiChat` | Feature | `/ai-chat` | weak single-domain alignment | chat shell, session actions, attachments, empty states |
| `store` | Feature | `/store`, `/apps` store-facing surfaces | `catalog`, `deploy`, `software` | one user flow spans multiple backend capabilities |
| `deploy` | Feature | `/deploy` flow | `deploy`, `software`, `routes` | flow-heavy UI; avoid splitting per backend package |
| `resources` | Domain-like | `/resources/**` | `resource` | stable business object vocabulary |
| `secrets` | Domain-like | `/secrets`, `/certificates` | `secrets`, `certs` | may split later if cert-specific copy grows large |
| `groups` | Domain-like | `/groups` | `groups` | business terms should stay consistent |
| `topics` | Domain-like | `/topics` | `topics` | domain vocabulary is stable |
| `feeds` | Domain-like | `/feeds` | `feeds` | source, analysis, fetch, parsing terms |
| `space` | Domain-like | `/space` | `space` | files, folders, sharing, lifecycle terms |
| `audit` | Domain-like | `/audit` | `audit` | actor, action, result, time, filters |
| `terminal` | Feature | `/terminal` | `terminal` | session/reconnect UX is frontend-led |
| `settings` | Feature | settings UI | `config` + mixed domains | schema-driven shell crosses many domains |
| `navigation` | Feature | layout / sidebar / global nav | n/a | global structure should not be forced into one business domain |

## Naming Rules

### Namespace naming

- prefer `camelCase` for namespace filenames already established in frontend code, for example `aiChat.json`
- keep the namespace name stable once introduced
- use singular namespace identity even if it covers multiple screens in one module

### Key naming

Use hierarchical keys grouped by role, not by component filename.

Examples:

- `page.title`
- `page.emptyTitle`
- `actions.delete`
- `fields.name`
- `dialog.deleteTitle`
- `messages.loadError`
- `aria.removeAttachment`

Do **not** encode component names into translation keys unless there is a real collision or ownership reason.

## When To Split A Namespace

Split a namespace only when one of these becomes true:

- the file is large enough to obscure ownership and review
- the namespace serves multiple independently evolving product surfaces
- the same namespace mixes shared business nouns with highly local interaction copy and causes churn

Examples:

- `secrets` may later split into `secrets` and `certificates`
- `resources` may later split if provider-accounts or connectors become large enough
- `settings` may remain one feature namespace while individual domain entries keep domain-owned terminology inside it

## Formatting Rules

Strings are only one part of i18n. Locale-aware formatting is part of this epic.

Rules:

- do not hardcode `'en'` in `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, or similar APIs inside translatable UI
- derive locale from the shared i18n layer
- use display locale for timestamps, durations, and related UI formatting
- do not translate backend payloads or model-generated freeform content

## Rollout Strategy

Epic 10 is delivered incrementally, module by module.

Recommended order:

1. feature entry points with dense hardcoded UI copy
2. shared navigation and layout text
3. high-traffic domain modules
4. lower-traffic admin and long-tail screens

Suggested rollout slices:

1. `aiChat`
2. `navigation`
3. `resources`
4. `deploy`
5. `secrets`
6. `groups` / `topics` / `feeds`
7. `space`
8. `audit` / remaining system pages

## Implementation Checklist For Each Slice

For every module migrated under Epic 10:

1. introduce or confirm the target namespace
2. add `en` and `zh` locale files
3. register the namespace in `web/src/lib/i18n.ts`
4. replace hardcoded UI strings with `useTranslation(namespace)`
5. replace hardcoded locale formatters with locale-aware formatting
6. update affected tests
7. run focused tests and frontend typecheck

## Initial Applied Slice

The first applied Epic 10 slice is `aiChat`:

- namespace added: `aiChat`
- page localized: `/ai-chat`
- relative time formatting made locale-aware
- sidebar AI chat label made translatable

This slice is the reference implementation for future modules.

## Open Decisions

These decisions are intentionally deferred until more modules migrate:

- whether `navigation` stays separate or folds into `common`
- whether `resources` should later split into `resources`, `connectors`, `platformAccounts`, and `aiProviders`
- whether `settings` gets one namespace or a shell namespace plus domain-owned sub-namespaces

## Success Criteria

Epic 10 is successful when:

- no new feature ships with hardcoded user-facing UI text by default
- module copy is localized through stable namespaces
- shared terms stay consistent across product surfaces
- locale-aware formatting replaces English-only formatting in translated UI
- namespace sprawl stays controlled and intentional
