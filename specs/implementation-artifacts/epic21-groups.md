# Epic 21: Groups

**Module**: Collaboration / Groups | **Status**: Proposed | **Priority**: P2 | **Depends on**: Epic 17, Epic 19

## Objective

Introduce `Groups` as the object-organization submodule under `Collaboration`. It replaces the previous `resource_groups` implementation entirely and provides a clean visual grouping model for applications and reusable platform objects.

## Requirements

- `Groups` appears under `Collaboration > Groups`.
- Groups are visual organization only; they are not a security boundary and do not affect runtime behavior.
- Supported object types are `app`, `server`, `secret`, `env_group`, `database`, `cloud_account`, `certificate`, `integration`, and `script`.
- Business tables do not store a `groups` field. Membership is owned by the Groups module.
- MVP does not model any user-to-group relationship. `Groups` and `group_items` do not carry user membership fields.
- A supported object may belong to multiple groups.
- A group/object pair has at most one membership record.
- MVP UI integration is required for `server` first; other supported object types may follow in later stories.
- Existing `resource_groups`, legacy business-table relations, and legacy group routes are fully removed.
- User-authored records and comments are out of scope here and handled by Epic 22 `Topics`.

## Scope Boundaries

| In scope | Out of scope |
|----------|-------------|
| Group CRUD and metadata | Tenant isolation / RBAC redesign |
| Assign any supported object to groups via junction table | Group-based access control |
| Cross-object group detail view | Group-based runtime restrictions |
| Group filters in list pages | Personal tags or per-user private groups |
| Clean removal of `resource_groups` and legacy routes | Backward compatibility with old group APIs |

## Navigation

Target navigation after this epic:

```
Collaboration
	Groups
	Topics

Applications
Resources
Credentials
```

`Groups` becomes a `Collaboration` submenu instead of being presented as a sub-feature of `Resources`.

## Data Model

### Design Principle

Groups owns membership. Business tables are not modified.

### `groups` (new collection, replaces `resource_groups`)

The physical collection `resource_groups` and all legacy relation fields on business tables are removed.

| Field | Type | Notes |
|-------|------|-------|
| `name` | Text | required, unique |
| `description` | Text | optional |
| `created_by` | Text | optional creator auth id |
| `created` | DateTime | auto |
| `updated` | DateTime | auto |

### `group_items` (new junction collection)

| Field | Type | Notes |
|-------|------|-------|
| `group_id` | Relation → `groups` | required |
| `object_type` | Text (enum) | `app` \| `server` \| `secret` \| `env_group` \| `database` \| `cloud_account` \| `certificate` \| `integration` \| `script` |
| `object_id` | Text | id of the referenced business object |
| `created` | DateTime | auto |
| `updated` | DateTime | auto |

- `group_id + object_type + object_id` is unique in business meaning and should be enforced in implementation.
- No user ownership or user-membership relation is modeled in MVP.

## UX Expectations

### Groups List

The Groups list page shows:

- Group name
- Description
- Total item count
- Breakdown by object type

### Group Detail

The Group detail page shows all assigned objects in one unified view with:

- Type
- Name
- Key summary fields
- Quick link to the original detail page

### Object Pages (Future)

Object-side integration (e.g., `Assign to Groups` on Servers) is planned for a follow-up story outside Stories 21.1–21.3.

## API / Backend Delta

### Remove Legacy

- Delete the `resource_groups` collection.
- Remove all `groups` relation fields from existing business-table schemas.
- Remove all routes under `/api/ext/resources/groups`.

### New Collections

Create `groups` and `group_items` collections as defined in the Data Model section.

### API Convention

Both collections are pure registry data (CRUD and metadata). Following the API Naming Baseline in `coding-decisions.md`, they use PocketBase native record paths only — no custom `/api/*` routes are introduced.

| Operation | Path |
|-----------|------|
| Group CRUD | `/api/collections/groups/records` |
| Group item CRUD | `/api/collections/group_items/records` |

Collection rule baseline for MVP:
- `groups` list/view: authenticated users
- `groups` create/update/delete: superuser only
- `group_items` list/view: authenticated users
- `group_items` create/update/delete: superuser only

## Acceptance Criteria

- `Groups` appears under the top-level `Collaboration` menu.
- Administrators can create, rename, and delete groups.
- Any supported object can be assigned to one or more groups without any schema change to the object's own collection.
- Group detail can display all assigned objects (any type) in one unified list, filterable by object type.
- Duplicate group item creation is prevented for the same group/object pair.
- No permission or runtime behavior changes are introduced by group membership or role.
- The `resource_groups` collection, its legacy routes, and all business-table `groups` relation fields are fully removed.
- UI copy uses `Groups` everywhere; the term `Resource Groups` does not appear in any user-facing surface.

## Stories

### Story 21.1 Groups Backend

See `story21.1-groups-backend.md`.

### Story 21.2 Groups Frontend

See `story21.2-groups-frontend.md`.

### Story 21.3 Groups Migration

See `story21.3-groups-migration.md`.

## Non-Goals

- No project or tenant model.
- No group ownership by end users.
- No group inheritance.
- No human membership or member-role model in MVP.
- No topic, comment, or message-thread capability inside the Groups schema.

## Integration Notes

- Epic 22 `Topics` is a standalone module with no dependency on the Groups schema. Story 22.3 addresses how the Groups module may surface Topics as contextual content by extending `group_items.object_type` to include `topic` — the same junction pattern used for all other object types. The `topics` collection itself is not modified.
- UI navigation follows the planning-artifact baseline: `Collaboration > Groups / Topics`.
- Legacy `/api/ext/resources/groups` references are retained only as removal targets during implementation.
- Recommended delivery order: `story21.1-groups-backend.md` → `story21.3-groups-migration.md` → `story21.2-groups-frontend.md`, with frontend allowed to parallelize after backend contract is stable.