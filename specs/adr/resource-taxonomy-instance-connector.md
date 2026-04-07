# Resource Taxonomy: Servers, Service Instances, Provider Accounts, and Connectors

## Status
Proposed

## Context
AppOS has accumulated several resource-like concepts that currently sit in different places and carry inconsistent semantics:

1. `server` already exists as a managed compute environment
2. `endpoints` currently mix generic outbound targets such as REST APIs, webhooks, and MCP servers
3. `settings` currently stores some long-lived external dependencies such as LLM providers
4. several future objects still need a stable home, including object storage, DNS, SMTP, registry login, runtime dependencies, and platform accounts

Without a stable resource taxonomy, the system will continue to drift in three ways:

1. domain boundaries become inconsistent across backend routes, persistence, and frontend navigation
2. the same technology family such as `llm` or `s3` gets modeled differently in each feature
3. `settings` turns into a storage area for real domain objects instead of remaining a reference layer

AppOS needs a product-facing taxonomy that users can understand and a backend-facing taxonomy that can scale without collapsing different object types into one overloaded schema.

## Decisions

### 1. Canonical top-level resource families

AppOS resource modeling is standardized into four top-level families:

| Family | Product label | Core meaning |
| --- | --- | --- |
| `server` | `Servers` | compute environments that host workloads and operational actions |
| `instance` | `Service Instances` | concrete service instances that applications depend on |
| `provider_account` | `Platform Accounts` | external platform identities, tenants, projects, or subscriptions |
| `connector` | `Connectors` | reusable connection configurations for external capabilities |

These four families are the canonical resource taxonomy for long-lived resource objects in AppOS.

### 2. User-facing terminology

AppOS must prefer user-facing labels that reflect operator mental models instead of architecture terminology.

| Backend concept | User-facing label | Reason |
| --- | --- | --- |
| `server` | `Servers` | already established and concrete |
| `instance` | `Service Instances` | clearer than `Runtime Service` and distinguishes service dependencies from servers |
| `provider_account` | `Platform Accounts` | expresses account, tenant, or organization scope in product language |
| `connector` | `Connectors` | expresses reusable access configuration |

The UI should avoid exposing `Runtime Service` as the primary term.

The preferred product label is `Platform Accounts`, while backend code and domain terminology remain `provider_account`.

### 3. Definition of an Instance

Product-facing label: `Service Instances`

An `instance` is a concrete service instance that an app depends on.

Minimum identity semantics:

1. it represents a real dependency instance, not just a connection method
2. it can be named and referenced as a stable object over time
3. it has an instance kind such as `mysql`, `postgres`, `redis`, `kafka`, `s3`, `registry`, or `ollama`
4. it may be self-hosted, external, or managed by a third party

Examples that should be modeled as `instance`:

1. self-hosted MySQL
2. third-party RDS PostgreSQL
3. Redis instance
4. MinIO instance
5. object storage dependency used by applications, including S3/OSS/R2 style storage when treated as a long-lived app dependency
6. Ollama or other self-hosted model service

An `instance` does not need full operational capabilities at creation time. The minimum supported shape may be registration-only, but it must still preserve instance identity semantics.

### 4. Definition of a Connector

A `connector` is a reusable connection configuration to an external capability.

Minimum semantics:

1. it represents how AppOS reaches a capability, not a managed service instance itself
2. it is primarily composed of endpoint, auth, template, capabilities, and secret references
3. it may optionally reference a `provider_account`
4. it is typically consumed by settings, workflows, publication, notifications, backup targets, or external integrations

Examples that should be modeled as `connector`:

1. OpenAI or Anthropic API access
2. SMTP delivery configuration
3. DNS automation target
4. webhook destination
5. MCP endpoint access
6. registry login configuration when AppOS is not managing the registry service instance itself

### 5. Definition of a Provider Account

A `provider_account` represents platform identity and authorization scope.

Minimum semantics:

1. it models account, tenant, organization, subscription, project, or installation context
2. it is not itself a concrete capability connection
3. it may support multiple connectors or instances

Examples:

1. AWS account or project scope
2. GitHub organization installation
3. Cloudflare account
4. Alibaba Cloud account
5. Feishu or enterprise identity tenant

### 6. Relationship rules

The canonical relationship rules are:

1. `server` may host apps and operational surfaces
2. `instance` may be referenced by apps, deployments, or workflows as runtime dependencies
3. `connector` may be referenced by settings, apps, deployments, publication, backup, or integration flows
4. `provider_account` may be referenced by zero or more `instance` and `connector` objects
5. `instance` and `connector` may both reference `secret` objects directly

`server` credentials must not be forced through `connector`. Server access is part of server identity and should continue to reference secrets directly or a future dedicated access profile.

### 7. Canonical classification rules for ambiguous technologies

AppOS must classify ambiguous technologies by the resource object being managed, not by protocol or vendor label alone.

| Technology | When it is an `instance` | When it is a `connector` |
| --- | --- | --- |
| `llm` | self-hosted or managed model service instance used as a stable dependency | third-party model API access configuration |
| `s3` / `oss` / `r2` | long-lived object storage dependency registered as an app-facing storage instance | temporary or inline target configuration only |
| `registry` | self-hosted Harbor or managed registry service treated as a service dependency | login or push/pull access configuration |
| `database` | actual database service instance, including third-party managed RDS | rarely a connector; inline connection-only configs should not replace an instance |

For resource-center modeling, AppOS standardizes `object storage` as an `instance` whenever it is registered as a long-lived reusable dependency.

### 8. Settings boundary

`settings` must no longer own long-lived business resources.

Settings may:

1. reference resource IDs
2. choose defaults such as default connector or default instance
3. hold lightweight platform preferences and policy values

Settings must not remain the canonical owner of LLM providers or similar long-lived external dependencies.

### 9. Migration direction for existing endpoint resources

The current `endpoints` concept is too narrow and semantically overloaded.

AppOS should evolve it toward `connectors` over time, but only for genuine external capability connections. The refactor must not force `instance` objects into the connector family.

### 10. Supporting objects are not part of the four top-level families

The four families above are the canonical top-level resource families, but they are not the entire object model of AppOS.

The following remain supporting or foundational objects rather than top-level resource families:

1. `secret`
2. `certificate`
3. `group`
4. `template`
5. `policy`

## Consequences

### Positive

1. users get a clearer product taxonomy with `Service Instances` and `Connectors` instead of overloaded `endpoints`
2. `settings` can shrink back to a reference and policy layer
3. backend modeling gains stable boundaries for future `llm`, `s3`, `registry`, `dns`, and `smtp` work
4. third-party managed dependencies such as RDS can be modeled naturally as instances

### Negative

1. current resource, settings, and route structure will need gradual migration
2. some existing `endpoint` objects may need reclassification
3. frontend navigation and creation flows need a taxonomy-aware redesign

### Follow-up work

1. create an implementation epic for resource taxonomy refactor
2. introduce `instances` as a new resource family
3. evolve `endpoints` into `connectors`
4. migrate LLM provider ownership out of settings
5. define creation flows that ask object-level questions without forcing users to choose domain terminology first