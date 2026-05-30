# Migrations Naming Rules

This folder contains AppOS PocketBase Go migrations.

## Execution Model

- Migrations are registered through Go `init()` functions with `migrations.Register(...)`.
- The runtime mechanism comes from PocketBase Go migrations.
- The filename structure after the numeric prefix is an AppOS repository convention.

## Filename Format

Use this format:

```text
<numeric_prefix>_<domain_or_scope>_<table_or_subject>.go
```

Examples:

```text
1740000001_resource_cloud_accounts.go
1763600000_app_instances.go
1762900000_deploy_deployments.go
1740500000_pb_users_patch.go
```

## Prefix Rules

- The numeric prefix must be unique.
- The numeric prefix must remain globally sortable.
- New migrations must use a prefix greater than existing earlier migrations that they depend on.
- Do not rename an already released migration prefix unless you are intentionally resetting migration history.
- The prefix does not need to be a real timestamp, but it must stay stable, monotonic, and sortable.

## Naming Rules After The Prefix

- Use no more than 3 words after the numeric prefix.
- The first word must not be a meaningless verb such as `add`, `create`, or `update`.
- Prefer a domain or scope word first, such as `app`, `resource`, `deploy`, `feed`, `pb`.
- Use the second or third word for the table or subject.
- Prefer stable nouns over action phrases.

Examples:

- Good: `resource_cloud_accounts`
- Good: `app_pipeline_runs`
- Good: `deploy_deployments`
- Good: `pb_users_patch`
- Bad: `add_users_name_avatar`
- Bad: `create_resource_collections`

## Built-in PocketBase Tables

- For PocketBase built-in tables, use the `pb_<table>_patch.go` form.
- All schema patches for the same built-in table should be absorbed into one file.
- Current example: `1740500000_pb_users_patch.go`.

## Schema Structure Principles

- Prefer one table per schema file.
- Treat the schema file for a table as the current final baseline for that table.
- When a table schema changes, prefer absorbing the schema delta into the owning table file instead of adding another long-lived schema patch file.
- If a file defines multiple tables, split it into one file per table when practical.
- If a patch only changes schema shape, absorb it back into the owning table file and delete the patch file.
- Keep public table names stable unless there is an explicit product decision to rename the table itself.

Examples:

- Good: one `resource_cloud_accounts` file that already contains the final schema.
- Good: one `app_instances` file that already includes later access-related fields.
- Bad: one base file plus many long-lived `add_*`, `expand_*`, `patch_*` schema files for the same table.

## Schema Patch Policy

- `Schema patch` means a migration that changes fields, indexes, relations, rules, or other collection structure.
- Schema patches should be temporary and should be folded back into the owning schema file during cleanup.
- After absorption, delete the old schema patch file.
- Cross-table schema dependencies should prefer idempotent `ensure...Collection` or `addFieldIfMissing` style helpers when ordering may vary.

## Data Migration Policy

- `Data migration` means backfill, row rewrite, record copy, seed repair, or content transformation.
- Keep data migrations logically separate from schema baselines.
- Do not hide data rewrite logic inside a file that is meant to represent the final schema shape.
- If the project is intentionally resetting history for MVP, obsolete data migrations may be removed, but that is a product/release decision and not the default rule.

## MVP Cleanup Policy

- During MVP convergence, prefer a clean final schema tree over preserving every intermediate schema step.
- The target state is a small set of stable baseline files, one table per file whenever practical.
- Old schema patch files should be absorbed and deleted.
- Mixed files that combine schema creation and schema patching should be rewritten into stable single-table baselines.
- Mixed files that combine schema and one-off data backfill should be split conceptually: keep the schema in the baseline file, and either move or intentionally drop the one-off data migration based on release needs.

## Domain Grouping Guidance

Use the filename to expose the owning domain clearly:

- `resource_*` for external resources and credentials
- `app_*` for app lifecycle tables
- `deploy_*` for deploy workflow tables
- `feed_*` for feeds tables
- `pb_*` for PocketBase built-in table patches

## Numbering Guidance

To reduce sorting drift across domains, reserve contiguous numeric ranges by domain whenever practical.

Examples in the current tree:

- `1740000000-1740009999` resource foundations and integrations
- `1740100000-1740799999` apps, space, groups, pb patch, settings, catalog
- `1762600000-1762999999` topics, envs, deploy, app lifecycle
- `1764700000-1765899999` monitor, software, docker runtime operations
- `1766000000-1766999999` feeds
- `1767000000-1767999999` assets and media

This range grouping is a repository convention, not a PocketBase requirement.

## Practical Rule

When adding a new migration:

1. Pick the owning domain first.
2. Reuse the domain prefix in the filename.
3. Pick the next sortable number inside that domain range.
4. Keep the suffix to at most 3 words.
5. Prefer one table per schema file.
6. If the change is only a schema-shape change, absorb it into the owning schema file instead of creating a long-lived patch file.
7. If the change touches a built-in PocketBase table, fold it into the existing `pb_<table>_patch.go` file instead of creating another patch file.