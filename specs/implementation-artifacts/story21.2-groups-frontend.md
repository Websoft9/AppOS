# Story 21.2: Groups UI

**Epic**: Epic 21 - Groups  
**Priority**: P2  
**Status**: Proposed  
**Depends on**: Story 21.1, Epic 7

---

## Objective

Implement the new `Groups` list page and `Group` detail page, based entirely on PocketBase native `groups` and `group_items` collections.

## Requirements

- Build Groups list view and Group detail view.
- Add a route for the Groups list and a route for individual Group detail.
- The story assumes a fully new Groups UI and does not reuse or preserve the old `Resource Groups` UI pattern.
- Group list and detail are based only on `groups` and `group_items`.
- Group detail shows mixed group items with type and summary info.
- This story does not include object-side Group consumption such as `servers` assigning or displaying groups.
- Create and maintain `src/lib/object-types.ts` as the shared constant defining valid `object_type` values and their metadata.

## UI Scope

### Navigation

- `Collaboration` is a sidebar visual grouping label only — it is not a route segment, not a page, and does not appear in breadcrumbs.
- In `Sidebar.tsx`, add `Collaboration` as a grouped nav item under Workspace, with `Groups` as its first child in this story.
- Group routes: `/groups` (list) and `/groups/$id` (detail).
- Route files: `_app/_auth/groups.index.tsx` and `_app/_auth/groups.$id.tsx`.
- Breadcrumb on list page: `Groups`. Breadcrumb on detail page: `Groups / <name>`.
- UI copy uses `Groups` consistently. `Resource Groups` does not appear.

## UI Layout

### Groups List Page Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Groups                                                      [ New Group ]   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Groups                                                                     │
│ Organize applications and reusable platform objects for clearer management │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ Search name...                ] [ Type filter ] [ Sort ]                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Name            Description         Total Items   Breakdown      Updated     │
│──────────────────────────────────────────────────────────────────────────────│
│ Customer A      Production stack    12            S:4 D:2 ...   2026-03-12  │
│                                                    [Edit] [Delete]          │
│ Finance         Shared infra         6            S:2 C:1 ...   2026-03-10  │
│                                                    [Edit] [Delete]          │
│ Dev Sandbox      Internal testing    3            App:1 S:2     2026-03-08  │
│                                                    [Edit] [Delete]          │
└──────────────────────────────────────────────────────────────────────────────┘

Empty state:

┌──────────────────────────────────────────────────────────────────────────────┐
│ No groups yet                                                               │
│ Create the first Group to organize related applications and resources.      │
│                                           [ New Group ]                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Group Detail Page Layout

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Groups / Customer A                                         [ Edit Group ]   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Customer A                                                                  │
│ Production resources for customer-facing workloads                          │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ Total Items: 12 ] [ Servers: 4 ] [ Databases: 2 ] [ Secrets: 3 ] ...     │
├──────────────────────────────────────────────────────────────────────────────┤
│ [ Add Items ]   [ Type: All v ]                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ Type        Name              Summary                      Updated Actions   │
│──────────────────────────────────────────────────────────────────────────────│
│ Server      web-01            10.0.0.12                    03-12   [...]    │
│ Database    customer-db       PostgreSQL prod              03-10   [...]    │
│ Secret      stripe-live       Payment credential           03-08   [...]    │
│ Certificate customer-tls      *.example.com                03-07   [...]    │
└──────────────────────────────────────────────────────────────────────────────┘

Item row actions:
- Remove from group

Empty state:

┌──────────────────────────────────────────────────────────────────────────────┐
│ This group has no items yet                                                 │
│ Add applications or reusable resources to start organizing this view.      │
│                                           [ Add Items ]                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Add Items Dialog Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ Add Items                                                    │
├──────────────────────────────────────────────────────────────┤
│ Object Type                                                  │
│ [ Servers v ]                                                │
│                                                              │
│ Search                                                       │
│ [ Search by name...                                     ]    │
│                                                              │
│ Available Objects                                            │
│ [ ] web-01         10.0.0.12                                 │
│ [ ] web-02         10.0.0.13                                 │
│ [ ] worker-01      background jobs                           │
│                                                              │
│                                    [ Cancel ] [ Add 3 ]      │
└──────────────────────────────────────────────────────────────┘
```

### Groups List Page

The Groups list page is the module landing page and should provide:

- Page title and one-line helper text explaining that Groups are for organization only.
- Primary action: `New Group`.
- Table or card-list view with these columns or fields:
	- `Name`
	- `Description`
	- `Total Items`
	- `Breakdown by Type`
	- `Updated`
- Row click navigates to Group detail.
- Row actions include:
	- `Edit`
	- `Delete` (with confirmation dialog before executing)
- Empty state includes explanation and create action.

**List page data assembly strategy:**
1. `GET /api/collections/groups/records` — load all groups.
2. `GET /api/collections/group_items/records?perPage=500` — load all items in one request.
3. Group items by `group_id` client-side to compute `Total Items` and `Breakdown by Type` per row.
4. Single-server deployments are not expected to have more than a few hundred group items total; one-shot load is acceptable.

No custom aggregation API is required.

### Group Detail Page

The Group detail page should provide:

- Header with group name, description, and edit action.
- Summary area with:
	- total item count
	- per-type counts
- Unified items table with these columns:
	- `Type`
	- `Name` — rendered as a clickable link that navigates to the object's own detail page using the object's known route (e.g., a `server` item navigates to `/servers/<object_id>`). Route mapping lives in `object-types.ts` as a `detailRoute` field.
	- `Summary`
	- `Updated` when available from the source object
	- `Actions`
- Supported list interactions:
	- filter by `type`
	- remove item from group (row action; no confirmation dialog required for item removal)
- Empty state for groups with no items.

### Group Create / Edit UX

- Create and edit use the same form pattern.
- Form fields are only:
	- `name`
	- `description`
- Validation errors are shown inline.
- Successful create redirects to the new Group detail page.

### Item Management UX

- Item add/remove is initiated from the Group detail page, not from object pages in this story.
- Add-item flow allows selecting object type first, then selecting one or more objects of that type.
- Removing an item is a row action on the Group detail page.

## Acceptance Criteria

- Groups list shows name, description, total item count, and breakdown by object type.
- Groups list includes create, edit, and delete actions.
- Group detail shows all items with type, name, summary fields, and link to object detail.
- Group detail can filter by object type.
- Group detail includes add-item and remove-item interactions.
- Creating, editing, deleting groups, and changing group items update the current UI state without full page reload.
- Create-group success navigates to Group detail.
- UI copy uses `Groups`; `Resource Groups` does not appear on new surfaces.
- No object-side Group UI is included in this story.

## object-types.ts Shared Constant

`src/lib/object-types.ts` is the single source of truth for valid `object_type` values, shared across the application. Each entry defines: `type`, `label`, `collection`, `nameField`, `summaryField`, `detailRoute`. See the source file for the complete mapping.

Table structure consumed by frontend follows the schema in `story21.1-groups-backend.md`.
| `updated` | datetime | optional display |

## API Definition

Frontend must prefer PocketBase native collection endpoints:

| Purpose | Method | Path |
|--------|--------|------|
| List groups | GET | `/api/collections/groups/records` |
| Create group | POST | `/api/collections/groups/records` |
| Update group | PATCH | `/api/collections/groups/records/{id}` |
| Delete group | DELETE | `/api/collections/groups/records/{id}` |
| List group items | GET | `/api/collections/group_items/records` |
| Add group item | POST | `/api/collections/group_items/records` |
| Remove group item | DELETE | `/api/collections/group_items/records/{id}` |

No custom `/api/ext/resources/groups` endpoints are introduced in this story.

## Integration Notes

- Consumes the PocketBase native collection contract from `story21.1-groups-backend.md`.
- This story implements routes under `_app/_auth/groups/`, not as an iteration on old `resources/groups` screens.
- Object-side group integration is limited to query/resolve display; schema ownership remains in Groups module.
- Topic integration (Epic 22) is out of scope here; this story should only expose stable group ids for later Topic linking.