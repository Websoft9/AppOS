# Runtime Instance Compatibility Contract

Status: accepted

Date: 2026-06-29

## Context

The current `Service Instances` model treats `kind` as a product-family identifier such as `mysql`, `postgres`, `redis`, `kafka`, or `s3`.

That model is no longer sufficient for the next phase of AppOS because `instances` will become a deploy-time dependency registry rather than only a registration surface. Once deployment workflows need to match application requirements against registered instances, the platform needs a stable compatibility contract rather than a product-name catalog.

The old model has three problems:

1. `kind` mixes multiple abstraction levels. Some values describe products (`rabbitmq`), some describe protocols (`mqtt`), and some describe ecosystem standards (`s3`).
2. Product names do not answer the real deploy question: which instances are safely substitutable for a given dependency slot?
3. Deployment matching cannot rely on UI categories or field shape alone. It needs a domain-level compatibility boundary.

This ADR finalizes the new model.

This decision does not preserve backward compatibility. Existing product-family kinds are not retained as aliases or fallback mappings.

## Decision

### 1. `kind` becomes a deploy-time compatibility contract

`kind` is no longer defined as a product-family label.

`kind` now means:

> the smallest runtime dependency contract that determines whether one registered instance can substitute for another during application deployment.

`kind` is not:

- a navigation category
- a vendor or product name
- a template label
- a UI grouping primitive

### 2. `category` stays product-facing and non-canonical

`category` remains a UI and discovery layer only.

It exists to help users browse and create instances, but it must never participate in deploy matching or domain identity.

### 3. `template_id` remains a kind-local profile

`template_id` stays inside one `kind` family only.

It represents product or provider presets, not compatibility contracts.

AppOS keeps this profile layer intentionally small. Templates exist to reduce dependency registration friction, not to mirror every provider SKU.

Examples:

- `mongodb-atlas`
- `opensearch`
- `generic-onlyoffice`

### 4. Traits become secondary matching metadata

Traits describe optional or orthogonal capabilities but do not replace `kind`.

Traits may later support ranking, filtering, and policy checks.

Examples:

- `relational`
- `sql`
- `cache`
- `pubsub`
- `object-storage`
- `tls`
- `secret-backed`

### 5. AppOS stays a lightweight resource access layer

Instances are for deployment-consumable dependencies, not for building a general CMDB or cloud inventory platform.

AppOS should help operators:

- register an external dependency once
- validate it
- reuse it during deployment
- apply simple reachability or capability checks

AppOS should not expand instance modeling just to capture provider-only inventory metadata such as finance, topology, or ownership fields that do not change deployment consumption.

## Final Domain Model

The runtime instance model is split into four layers:

1. `category`: user-facing browse group
2. `kind`: deploy-time compatibility contract
3. `template_id`: kind-local profile preset
4. `traits`: optional capability descriptors

### Category responsibilities

- create flow navigation
- resource center copy
- visual grouping

### Kind responsibilities

- deploy slot matching
- probe / binding adapter selection
- instance contract identity

### Template responsibilities

- product preset labels
- default endpoint values
- kind-specific config fields
- vendor or managed-service specialization

### Trait responsibilities

- soft filtering
- preference ranking
- policy and recommendation logic

## Final Kind Vocabulary

The accepted clean-slate kind vocabulary is:

### Database

- `mysql-compatible`
- `postgres-compatible`
- `mongodb-compatible`
- `clickhouse-compatible`
- `neo4j-compatible`
- `influxdb-compatible`

These kinds remain separate because their drivers, DSN shape, query model, client libraries, and deploy-time binding semantics are not safely interchangeable.

`relational-db` is explicitly rejected as too broad for deploy-time substitution.

### Search

- `elasticsearch-compatible`

`opensearch` is treated as a profile under this kind, not as a separate kind.

### Cache

- `redis-compatible`

### MQ

- `kafka-compatible`
- `amqp-compatible`
- `nats-compatible`
- `mqtt-compatible`

This is a direct replacement of the earlier mixed product/protocol model.

`rabbitmq` is no longer a kind. It becomes a profile under `amqp-compatible`.

`redpanda` is not a kind. It is only a search alias that should map to `kafka-compatible`.

### Storage

- `s3-compatible`

### Application Service

- `onlyoffice-compatible`

This kind is separate from external HTTP gateway connectors because the consuming app typically expects an application-level document-editing service contract, not just a generic HTTP endpoint.

## Final Category Vocabulary

The product-facing create categories are:

- `database`
- `cache`
- `search`
- `message-queue`
- `storage`
- `traffic-gateway`
- `application-service`

These categories are allowed to remain visually stable even if specific kinds evolve over time.

## Template Rules

### Template directory names

Template directory names must equal the canonical compatibility-contract `kind` values.

Examples:

- `templates/mysql-compatible/`
- `templates/postgres-compatible/`
- `templates/amqp-compatible/`

### Template purpose

Templates model profile presets, not compatibility identity.

Examples:

- `generic-mysql`
- `generic-postgres`
- `mongodb-atlas`
- `cloudamqp`
- `opensearch`
- `generic-onlyoffice`

### Template governance

Each supported `kind` must have exactly one `generic-*` template.

Additional templates are allowed only when at least one of the following is true:

- the preset removes real setup steps or reduces connection mistakes
- the preset adds a strong product mental model that users reliably recognize
- the preset is needed for future probe, import, or policy specialization

The following are explicitly discouraged:

- provider-only templates that differ only by label
- templates whose only extra fields are weak inventory metadata such as provider or region
- catalogs that try to mirror every cloud SKU

### Template fields

Templates continue to contain only non-canonical config.

Canonical fields stay outside template fields:

- `name`
- `endpoint`
- `credential`
- `description`

Product UI may split canonical fields for usability, but templates do not own those semantics.

## First-Wave Catalog

The first-wave instance catalog is intentionally small.

| Category | Kind | Traits | First-wave templates |
| --- | --- | --- | --- |
| `database` | `mysql-compatible` | `relational`, `sql` | `generic-mysql` |
| `database` | `postgres-compatible` | `relational`, `sql` | `generic-postgres` |
| `database` | `mongodb-compatible` | `document`, `nosql` | `generic-mongodb`, `mongodb-atlas` |
| `database` | `clickhouse-compatible` | `analytical`, `sql`, `columnar` | `generic-clickhouse`, `clickhouse-cloud` |
| `database` | `neo4j-compatible` | `graph` | `generic-neo4j`, `neo4j-aura` |
| `database` | `influxdb-compatible` | `timeseries` | `generic-influxdb`, `influxdb-cloud` |
| `cache` | `redis-compatible` | `cache`, `kv` | `generic-redis` |
| `search` | `elasticsearch-compatible` | `search`, `index` | `generic-elasticsearch`, `elastic-cloud`, `opensearch` |
| `message-queue` | `kafka-compatible` | `pubsub`, `streaming` | `generic-kafka` |
| `message-queue` | `amqp-compatible` | `pubsub`, `queue` | `generic-rabbitmq`, `cloudamqp` |
| `message-queue` | `nats-compatible` | `pubsub`, `lightweight` | `generic-nats` |
| `message-queue` | `mqtt-compatible` | `pubsub`, `iot` | `generic-mqtt`, `emqx-cloud` |
| `storage` | `s3-compatible` | `object-storage` | `generic-s3` |
| `application-service` | `onlyoffice-compatible` | `document`, `editor`, `collaboration` | `generic-onlyoffice` |

Anything outside this catalog should be treated as a later expansion, not as the default baseline.

`http-gateway` is intentionally excluded from the instance catalog. It belongs to the External Services connector model.

## Deploy Dependency Model

Instances are not matched to deployments by category.

Deployments consume instances through explicit dependency slots.

### Dependency slot

A dependency slot is one app-level requirement that expects one instance contract.

Examples:

- `primary_db`
- `cache`
- `message_bus`
- `object_storage`
- `edge_gateway`

Each slot declares its compatibility contract explicitly.

### Slot shape

The finalized slot contract is:

```yaml
dependencies:
  - key: primary_db
    title: Primary Database
    acceptedKinds:
      - postgres-compatible
      - mysql-compatible
    preferredKind: postgres-compatible
    requiredTraits:
      - relational
      - sql
    optional: false

  - key: cache
    title: Cache
    acceptedKinds:
      - redis-compatible
    optional: true

  - key: object_storage
    title: Object Storage
    acceptedKinds:
      - s3-compatible
    optional: true
```

### Matching rules

AppOS matches a dependency slot to registered instances in this order:

1. `kind` must be in `acceptedKinds`
2. required traits must be present
3. instance must be enabled
4. instance should be reachable when reachability data exists
5. ranking may use `preferredKind`, group scope, or future policy signals

Category never participates in matching.

Template id never participates in contract acceptance. It only influences ranking, defaults, and adapter specialization.

## Binding Model

App templates must not read raw instance payloads directly.

They bind through slot-level binding rules.

### Binding purpose

Binding converts instance canonical fields and config into app deployment inputs such as env vars, DSNs, mounted files, or rendered config.

### Binding example

```yaml
bindings:
  primary_db:
    env:
      DB_HOST: host
      DB_PORT: port
      DB_NAME: config.database
      DB_USER: config.username
      DB_PASSWORD: credential.value

  cache:
    env:
      REDIS_URL:
        from: dsn
```

### Adapter boundary

DSN or connection-string generation belongs to the compatibility contract adapter, not to app templates and not to the deployment UI.

Examples:

- `mysql-compatible` adapter builds a MySQL DSN
- `postgres-compatible` adapter builds a PostgreSQL DSN
- `redis-compatible` adapter builds a Redis URL

This is why `mysql-compatible` and `postgres-compatible` remain separate kinds even though both are relational databases.

## Monitoring Boundary

Monitoring must not understand template structure or contract semantics directly.

The `instances` domain owns probe-target resolution and other contract-derived connection knowledge.

Monitor consumes instance-domain capabilities only.

This principle already applies to probe target resolution and must remain the standard for future connection-derived logic.

## Explicit Rejections

The following approaches are rejected:

1. Product-name kinds as the long-term contract model.
  Example rejected values: `rabbitmq`, `redpanda`, `minio`.

2. A single broad `relational-db` kind.
   This loses deploy-time substitution accuracy.

3. Category-driven deployment matching.
   Categories are UI-only.

4. Template-driven identity.
   Templates are presets, not contracts.

5. Backward-compatibility aliases.
   The old kind vocabulary will not be preserved in parallel.

## Clean-Slate Migration Rule

This design is accepted as a clean-slate replacement.

Implementation must:

- rename current instance kinds to the new contract vocabulary
- remove the old product-family kind vocabulary from code and templates
- rename template directories to contract-kind directories
- reclassify product names such as `rabbitmq` and `redpanda` as search aliases or optional presets, not kinds
- update all frontend and backend validation to the new kind set

Implementation must not:

- keep old kinds as aliases
- support dual read/write kind modes
- auto-translate old values at runtime
- introduce compatibility shims in frontend or backend APIs

## Initial Implementation Scope

The first implementation wave should do the following:

1. Replace the current kind constants with the finalized compatibility-contract vocabulary.
2. Rename template folders and profile ids as needed.
3. Update frontend category/kind labels and metadata.
4. Replace any kind-specific probe fallback or adapter lookup with the new kind set.
5. Freeze a dependency-slot schema for future deploy integration.

The first implementation wave should not yet ship a full deployment binding UI. It only needs to define the stable contract that deployment work will consume next.

## Consequences

### Positive

- `kind` becomes consistent across instance registry, monitoring, and future deployment logic.
- Product presets no longer distort domain identity.
- Deploy matching becomes explicit and predictable.
- App templates gain a stable contract vocabulary for dependency declarations.

### Negative

- Existing product-family semantics in specs and code become obsolete immediately.
- Template folder names and profile naming conventions must be updated together.
- Some previously intuitive product names become profile names rather than top-level kinds.

### Follow-up

- finalize trait vocabulary
- define deployment slot schema in detail
- define binding adapter interfaces per kind
- refactor current instance templates and UI to the new vocabulary