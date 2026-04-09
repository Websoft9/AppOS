---
workflowType: 'prd'
workflow: 'edit'
classification:
  projectType: 'Infrastructure Tool'
  domain: 'DevOps Tool'
  complexity: 'Medium'
inputDocuments:
  - /data/dev/appos/specs/planning-artifacts/prd.md
stepsCompleted:
  - step-e-01-discovery
  - step-e-02-review
  - step-e-03-edit
lastEdited: '2026-02-28'
editHistory:
  - date: '2026-02-28'
    changes: 'Restructured to BMAD minimal format and focused MVP on server resource operations and diagnostics.'
  - date: '2026-04-03'
    changes: 'Refined resource domain modeling: Resource now centers on Server, Database, Connector, and Registry; Groups remain standalone in Operations Management; future heavy integrations should reference Connector rather than replace it.'
---

# Product Requirements Document - AppOS

**Author:** AppOS  
**Date:** 2026-02-28  
**Version:** 1.1

## Executive Summary

AppOS is a single-server-first app operations and lifecycle platform.

This PRD defines the current MVP baseline:

- application lifecycle control
- unified resource operations
- operational visibility
- safe runtime configuration

The primary operator outcomes are: execute lifecycle actions, operate local and remote resources from one surface, inspect app and platform health, and manage configuration or credential assets safely.

## Domain, Product Module, and Object Mapping

This table is the baseline mapping of domain boundaries, product modules, and candidate objects.

| Domain | Subdomain | Product Module | Status | Proposed Aggregate Root | Candidate Objects |
| --- | --- | --- | --- | --- | --- |
| Application Lifecycle | App Instance Management | Apps, Installed Apps, App Detail | Current | `AppInstance` | `AppInstance`, `AppSummary`, `DesiredState` |
| Application Lifecycle | Operation Management | Actions, Operations, Operation Detail, Operation Timeline | Current | `Operation` | `OperationJob`, `OperationLog`, `OperationOutcome` |
| Application Lifecycle | Release Management | Releases, Current Release, Release History | Current | `Release` | `ReleaseSnapshot`, `ReleaseRole`, `ReleaseDiff` |
| Application Lifecycle | Exposure Management | Exposures, Domains, Publication Detail | Current + Planned | `Exposure` | `Exposure`, `DomainBinding`, `PublicationState` |
| Application Lifecycle | Recovery Management | Backup, Restore, Rollback, Recover | Current + Planned | `RecoveryPlan` | `RecoveryPlan`, `RollbackPoint`, `RecoveryOutcome` |
| Application Lifecycle | Application Topology & Coordination | App Topology, Node Roles, Failover View | Planned | `AppTopology` | `AppTopology`, `DeploymentUnit`, `NodeAssignment` |
| Lifecycle Execution | Pipeline Execution | Pipelines, Pipeline Detail | Current | `PipelineRun` | `PipelineRun`, `PipelineNodeRun`, `PipelinePhase` |
| Lifecycle Execution | Worker Scheduling | No standalone module; surfaced through operation status | Internal | `None (internal mechanism)` | `WorkerClaim`, `ExecutionSlot`, `QueueState` |
| Lifecycle Execution | Projection Update | No standalone module; surfaced through app and operation projections | Internal | `None (internal mechanism)` | `ProjectionTarget`, `ProjectionVersion`, `ProjectionState` |
| Lifecycle Execution | Compensation Control | Compensation Timeline, Retry / Resume Controls | Planned | `CompensationPlan` | `CompensationPlan`, `CompensationStep`, `ResumeToken` |
| Resource | Server Access | Tunnels, Servers, Connect | Current | `Server` | `Server`, `TunnelEndpoint`, `TunnelSession` |
| Resource | Server Terminal Operations | Terminal, Server Shell | Current | `TerminalSession` | `TerminalSession`, `ExecSession`, `ShellProfile` |
| Resource | Server File Operations | Server Files, SFTP, File Browser | Current | `RemoteFileSession` | `RemoteFile`, `TransferJob`, `DirectoryEntry` |
| Resource | Server Service Operations | Components, Services, Service Logs, Systemd Diagnostics | Current | `ServiceTarget` | `ServiceStatus`, `ServiceLogView`, `ServiceAction` |
| Resource | Server Container Operations | Docker, Containers, Compose, Exec | Current | `RuntimeContainer` | `ContainerRef`, `ComposeProject`, `ContainerAction` |
| Resource | Database Resources | Databases, Database Bindings | Current + Planned | `DatabaseResource` | `DatabaseResource`, `DatabaseCredentialRef`, `DatabaseEndpoint` |
| Resource | Connector Resources | Connectors, Webhooks, MCP, SMTP, Registry, DNS | Current | `Connector` | `Connector`, `ConnectorCapability`, `ConnectorCredentialRef` |
| Resource | Registry Resources | Registries, Artifact Sources, Registry Settings | Current + Planned | `Registry` | `Registry`, `ArtifactSource`, `RegistryCredentialRef` |
| Observability | Telemetry | Metrics, Logs, Events, Container Stats | Current | `TelemetryStream` | `MetricSeries`, `LogEntry`, `PlatformEvent` |
| Observability | Health & Diagnostics | Health, Diagnostic Views, App Health, Connectivity Checks | Current + Planned | `HealthCheckSet` | `HealthSummary`, `DiagnosticSignal`, `CheckResult` |
| Observability | Platform Self-Observation | AppOS Status, Active Services, System Crons | Current + Planned | `PlatformStatusSnapshot` | `ComponentStatus`, `ServiceStatus`, `CronStatus` |
| Operations Management | Groups & Inventory Views | Groups, Resource Inventory, Resource Graph | Current + Planned | `Group` | `Group`, `GroupItem`, `ResourceReference`, `ResourceEdge`, `OwnershipBinding` |
| Operations Management | External Signals | Feeds | Planned | `Feed` | `FeedSource`, `FeedItem`, `FeedJudgment`, `FeedBinding` |
| Operations Management | Operational Knowledge | Topics | Current | `Topic` | `Topic`, `TopicPost`, `TopicReference` |
| Operations Management | Operational Knowledge | Space | Current | `KnowledgeDocument` | `KnowledgeDocument`, `KnowledgeFolder`, `Attachment` |
| Operations Management | Incident Response | Alerts, Incidents, Notification Rules, Incident Timeline | Planned | `Incident` | `Incident`, `AlertRule`, `EscalationPolicy` |
| Operations Management | Operations Automation | Operational Procedures, Script Library, Scheduled Jobs | Current + Planned | `Procedure` | `Procedure`, `ProcedureStep`, `ProcedureRun` |
| App Catalog | Catalog Discovery | Store, Catalog, App Listing, Category Navigation, Search | Current | `CatalogApp` | `CatalogApp`, `CatalogCategory`, `CatalogFilter`, `TemplateRef` |
| App Catalog | Custom App Authoring | Custom Apps, Shared Apps, Private App Definitions | Current | `CustomApp` | `CustomApp`, `CustomAppSource`, `CustomAppVisibility`, `TemplateRef` |
| App Catalog | Catalog Personalization | Favorites, Store Notes, Future Saved Views | Current | `UserCatalogState` | `Favorite`, `CatalogNote`, `UserCatalogState` |
| Runtime Infrastructure | Runtime Execution | Docker / Compose Runtime, Compose Config | Current | `RuntimeProject` | `RuntimeProject`, `ComposeSpec`, `RuntimeAction` |
| Runtime Infrastructure | Recovery Assets | Backups, Restore Artifacts | Current | `BackupSnapshot` | `BackupSnapshot`, `BackupArtifact`, `RestoreRequest` |
| Runtime Infrastructure | Configuration Assets | IaC Workspace, IaC Browser, Shared Envs, Runtime Settings | Current + Planned | `IaCWorkspace` | `IaCWorkspace`, `IaCFile`, `SharedEnvSet` |
| Gateway Management | Domain Binding | Domains, Gateway Domains, App Exposure Bindings | Current + Planned | `DomainBinding` | `DomainBinding`, `Hostname`, `BindingScope` |
| Gateway Management | Routing & Upstreams | Proxy, Route Config, Upstream Targets, Gateway Routes | Current + Planned | `GatewayRoute` | `GatewayRoute`, `UpstreamTarget`, `BackendRef` |
| Gateway Management | Certificate Binding | SSL, TLS Bindings, Certificate Attachments | Current + Planned | `CertificateBinding` | `CertificateBinding`, `TlsPolicy`, `CertificateRef` |
| Gateway Management | Gateway Policies | Publish Policies, Routing Policies, Access Rules | Planned | `GatewayPolicy` | `GatewayPolicy`, `RoutingPolicy`, `PublishConstraint` |
| Gateway Management | Gateway Views | Gateway Overview, Domain View, Route Inventory | Planned | `TBD (view projection)` | `GatewayView`, `RouteInventoryItem`, `BindingSummary` |
| Integrations | Source Integrations | Git Sources, Source Connectors | Planned | `SourceIntegration` | `SourceIntegration`, `RepositoryBinding`, `ConnectorRef` |
| Integrations | Notification Integrations | Email Channels, Webhooks, Chat Connectors | Planned | `NotificationIntegration` | `NotificationIntegration`, `DeliveryChannel`, `ConnectorRef` |
| Integrations | AI Provider Integrations | LLM Providers, Model Integrations | Current + Planned | `AIProviderIntegration` | `AIProviderIntegration`, `ModelConnector`, `ConnectorRef` |
| Integrations | External Secret / Identity Integrations | External Secret Backends, SSO, Identity Bridges | Planned | `IdentityIntegration` | `ExternalSecretProvider`, `IdentityIntegration`, `FederationBinding` |
| Integrations | Workflow / Sync Integrations | Data Sync, CI/CD, Callback Automation | Planned | `WorkflowIntegration` | `WorkflowIntegration`, `SyncBinding`, `ConnectorRef` |
| AI Workflow / Agent Automation | Skills | Skills Library | Planned | `Skill` | `Skill`, `SkillCapability`, `SkillInputSchema` |
| AI Workflow / Agent Automation | Task Plans | Task Plan Builder, Planned Workflows | Planned | `TaskPlan` | `TaskPlan`, `TaskStep`, `TaskConstraint` |
| AI Workflow / Agent Automation | Guided Automation | Guided Ops Flows, AI-Assisted Runbooks | Planned | `GuidedFlow` | `GuidedFlow`, `AutomationContext`, `FlowCheckpoint` |
| AI Workflow / Agent Automation | Domain-Specific Agents | Specialized Agents, Copilot Actions | Planned | `AgentProfile` | `AgentProfile`, `AgentTask`, `AgentResult` |
| Edition & Entitlement | Edition Model | Edition Overview, Plan Comparison | Planned | `Edition` | `Edition`, `EditionCapabilitySet`, `EditionRule` |
| Edition & Entitlement | License Activation | License Center, Activation Flow | Planned | `License` | `License`, `ActivationRecord`, `LicenseFingerprint` |
| Edition & Entitlement | Subscription State | Subscription Status, Renewal State | Planned | `Subscription` | `Subscription`, `SubscriptionState`, `ExpiryWindow` |
| Edition & Entitlement | Feature Entitlements | Entitlement Summary, Feature Availability | Planned | `Entitlement` | `Entitlement`, `CapabilityFlag`, `UsageLimit` |
| Platform Configuration | Platform Configuration | Settings, Settings Schema, Settings Entries | Current | `SettingEntry` | `SettingEntry`, `SettingSchema`, `SettingScope` |
| Identity and Access | Identity and Access | Setup, Auth, Users, Access Control | Current + Planned | `User` | `User`, `Session`, `AccessGrant` |
| Secrets Management | Secrets Management | Credentials, Secrets, Secret Reveal / Resolve | Current + Planned | `Secret` | `Secret`, `SecretPayload`, `SecretUsage`, `AccessMode`, `RevealRule` |
| Audit and Policy | Audit and Policy | Audit Log, Policy Events, Compliance Views | Current + Planned | `AuditEntry` | `AuditEntry`, `PolicyDecision`, `PolicyEvent` |
| AI Assistant | Suggestion | Embedded Copilot Suggestions | Planned | `SuggestionSession` | `Suggestion`, `SuggestionContext`, `SuggestionAction` |
| AI Assistant | Explanation | Explain This, Failure Explanation | Planned | `ExplanationRequest` | `Explanation`, `ExplanationSource`, `ReasoningNote` |
| AI Assistant | Guidance | Guided Help, Contextual Recommendations | Planned | `GuidanceCard` | `GuidanceCard`, `GuidanceStep`, `Recommendation` |
| AI Assistant | Contextual Help | Inline Help, Smart Hints | Planned | `HelpTopic` | `HelpHint`, `ContextAnchor`, `HelpTopic` |
| AI Assistant | Embedded Copilot Experience | Global Assistant, In-Page Assistant | Planned | `AssistantSession` | `AssistantSession`, `AssistantIntent`, `AssistantResponse` |

Rules:

- Domains and subdomains should stay stable.
- Product modules may change with UX and navigation.
- One product module may map to multiple rows when it projects capabilities from multiple domains.
- `Proposed Aggregate Root` is a lightweight modeling decision for PRD alignment, not a final persistence or transaction design.
- The table should cover all domains and subdomains, even when a subdomain has no standalone module yet.
- Objects belong to the model, not to the menu.

Resource modeling note:

- `Resource` is the namespace for operator-managed external resources. The current first-class resource types are `Server`, `Database`, `Connector`, and `Registry`.
- `Server` is already a full business domain. `Database`, `Connector`, and `Registry` currently start thinner but should evolve independently rather than being collapsed into one generic resource blob.
- `Groups` is not a resource subtype. It is a standalone supporting domain for cross-resource visual grouping and membership.
- `Feeds` is not an integration transport subtype. Connector or fetch mechanics may supply external data, but feed judgment and binding belong to `Operations Management`.
- `Secrets Management` remains outside `Resource`; resources may reference secrets, but a secret is a security capability, not an external connection target.
- Future heavy third-party workflows should become standalone `Integrations` domains that reference `Resource.Connector` instead of overloading the connector resource itself.

## Product Surface and Navigation Mapping

This table maps user-facing surfaces to the domains they project.

| Surface / Entry | Type | Owned Domains | Primary Routes / Entrypoints | Current Reality |
| --- | --- | --- | --- | --- |
| Workspace | Navigation Group | Multiple | `/dashboard`, `/store`, `/deploy`, `/actions`, `/apps`, `/terminal`, `/groups`, `/feeds`, `/topics`, `/space` | Current sidebar grouping for day-to-day operator work; not a domain |
| Admin | Navigation Group | Multiple | `/status`, `/tunnels`, `/logs`, `/audit`, `/iac`, `/resources`, `/secrets`, `/certificates`, `/shared-envs`, `/users`, `/settings` | Current sidebar grouping for platform administration; not a domain |
| Dashboard | Overview Surface | `Application Lifecycle`, `Observability`, `Platform Self-Observation` | `/dashboard` | Cross-domain summary and entry page; should stay an overview, not become its own domain |
| Applications | Navigation Bundle | `Application Lifecycle`, `App Catalog` | `/store`, `/deploy`, `/actions`, `/apps` | Current collapsible navigation bucket that groups the app journey |
| App Store | Single-Domain Entry with supporting projections | `App Catalog`, `Edition & Entitlement` | `/store` | Real module for catalog discovery, custom apps, personalization, and template-backed deploy handoff |
| Deploy | Task-Oriented Entry | `Application Lifecycle`, `Runtime Infrastructure` | `/deploy`, `/deploy/create` | User flow for install or deployment initiation; product entry, not a separate domain |
| Actions | Single-Domain Entry with execution projection | `Application Lifecycle`, `Lifecycle Execution` | `/actions`, `/actions/$actionId` | Operation list and detail surface projecting both lifecycle state and execution state |
| Installed Apps | Single-Domain Entry | `Application Lifecycle` | `/apps`, `/apps/$appId` | Current installed app list and app detail entry |
| App Detail | Cross-Domain Container | `Application Lifecycle`, `Observability`, `Resource`, `Gateway Management` | `/apps/$appId` | App-centric work surface that can aggregate status, actions, exposures, diagnostics, and control surfaces |
| Terminal | Single-Domain Entry with cross-links | `Resource` | `/terminal`, `/terminal/server/$serverId` | Real control surface; can be launched from app or server context without becoming a lifecycle domain |
| Collaboration | Navigation Bundle | `Operations Management` | `/groups`, `/feeds`, `/topics` | Current grouping for collaboration and operational knowledge workflows |
| Feeds | Single-Domain Entry | `Operations Management` | `/feeds` | Dedicated external signal workbench for source monitoring, filtering, judgment, and binding |
| Space | Single-Domain Entry | `Operations Management` | `/space` | User workspace / document surface for operational knowledge artifacts |
| Resources | Cross-Domain Container | `Resource`, `Operations Management` | `/resources`, `/resources/servers`, `/resources/tunnels`, `/resources/scripts`, `/resources/connectors`, `/resources/groups`, `/resources/databases`, `/resources/cloud-accounts` | Inventory-style container for external resources plus cross-resource grouping views; connectors are the canonical surface for reusable external capability access |
| System | Cross-Domain Container | `Observability`, `Runtime Infrastructure`, `Audit and Policy` | `/status`, `/tunnels`, `/logs`, `/audit`, `/iac` | Admin container for platform health, tunnel state, logs, audit, and IaC assets |
| Users | Single-Domain Entry | `Identity and Access` | `/users`, `/profile` | Account and access administration surface |
| Credentials | Navigation Bundle | `Secrets Management`, `Gateway Management`, `Runtime Infrastructure` | `/secrets`, `/certificates`, `/shared-envs` | Current admin grouping for secret-like assets with different domain ownership |
| Settings | Cross-Domain Configuration Entry | `Platform Configuration`, `Resource`, `Secrets Management` | `/settings`, `/admin/credentials/env-vars` | Composite configuration surface driven by settings schema/controllers rather than by one business domain |
| Setup / Auth Entrypoints | Entry Flow | `Identity and Access`, `Platform Configuration` | `/setup`, `/login`, `/register`, `/forgot-password`, `/reset-password` | System entry flows; required product surface, but not part of the business domain hierarchy |
| Public Share Surface | External Entry | `Operations Management` | `/share/topic/$token` | Public delivery surface for shared topic content, derived from domain data but not a separate module family |

Rules:

- A product surface may project one domain, multiple domains, or just navigation intent.
- Navigation groups such as `Workspace` and `Admin` should never be promoted to domains unless they gain stable business responsibility.
- Container surfaces such as `App Detail`, `Resources`, `System`, and `Settings` are allowed to aggregate multiple domains without collapsing those domains.
- Route structure and sidebar grouping are IA evidence, not domain evidence.

## Technical Mechanism Mapping

This table records implementation mechanisms that support product capabilities but are not business domains.

| Mechanism | Mechanism Category | Supports Domains | Product Exposure | Current Evidence / Notes |
| --- | --- | --- | --- | --- |
| CLI / Exec | Command execution mechanism | `Resource`, `Runtime Infrastructure` | Direct + Indirect | Exposed through terminal sessions, docker exec, compose actions, and tunnel setup scripts; mechanism, not domain |
| SSH Tunnel Session | Remote connectivity mechanism | `Resource` | Direct | Backing mechanism for `/tunnels`, `/resources/tunnels`, `/terminal/server/$serverId`, and server session setup |
| SFTP / Remote File Access | Remote file transport mechanism | `Resource` | Direct | Powers server file browser and transfer flows; implementation mechanism under file operations |
| Docker / Compose Executor | Runtime execution mechanism | `Application Lifecycle`, `Runtime Infrastructure`, `Resource` | Direct + Indirect | Used by lifecycle actions, runtime control, docker page, and compose operations |
| Asynq Queue | Background task queue | `Lifecycle Execution`, `Application Lifecycle`, `Runtime Infrastructure` | Indirect | Used to enqueue deploy, backup, restore, and lifecycle operation tasks |
| Embedded Worker | Background execution worker | `Lifecycle Execution` | Indirect | PocketBase-embedded worker processes queue tasks, recovers orphaned work, and writes execution state |
| Lifecycle Scheduler | Polling / dispatch mechanism | `Lifecycle Execution` | Indirect | Periodically dispatches queued lifecycle operations; supports operation progression rather than representing a domain |
| Cron Jobs | Scheduled execution mechanism | `Observability`, `Platform Self-Observation`, `Operations Automation` | Direct + Indirect | Surfaced in `/system-tasks` and the status screen; scheduling itself is not a domain |
| Structured Cron Logs | Execution trace mechanism | `Observability` | Direct | `/api/crons/{jobId}/logs` and `System Crons` UI expose instrumented cron history |
| Domain Events | State transition mechanism | `Application Lifecycle`, `Lifecycle Execution` | Indirect | Lifecycle code applies events to records and advances state; event semantics belong to the owning domain |
| Projection Updater | Read-model mechanism | `Lifecycle Execution`, `Application Lifecycle`, `Observability` | Indirect | Projection application keeps app and operation summaries current; read-model support, not business capability |
| Settings Schema / Controller | Configuration composition mechanism | `Platform Configuration`, `Resource`, `Secrets Management` | Direct + Indirect | Current settings UI is assembled from shared controllers and schema-driven sections |
| Share Token Resolver | Public access mechanism | `Operations Management` | Indirect | Share links for topics are delivered via token validation and public routes; mechanism under collaboration sharing |
| Audit Writer | Traceability mechanism | `Audit and Policy` | Indirect + Direct | HTTP handlers and async workers both write audit records that later appear in audit views |

Rules:

- Technical mechanisms should not be listed as domains unless they gain stable business responsibility and user-facing policy semantics.
- A mechanism may be directly exposed in UI and still remain a mechanism rather than a domain.
- `CLI`, `Cron`, `Worker`, `Queue`, `Projection`, and `Event` are implementation or interaction mechanisms in the current AppOS model.
- Mechanism ownership follows the domain it supports; it does not replace the domain boundary.

## Success Criteria

- Core lifecycle actions return accepted status within 3 seconds and complete successfully in ≥ 95% of supported cases.
- Operators can reach terminal, file, container, or service operations for a managed target within 10 seconds.
- Runtime configuration assets such as shared envs, registry settings, proxy settings, and credentials can be saved and applied with explicit success or failure status in ≤ 30 seconds.
- App and platform status surfaces expose recent health, logs, and task state within 10 seconds for common diagnostic paths.
- Failed operations return actionable state, error reason, and next-step guidance.

## Product Scope

### MVP

- Application lifecycle actions: install, start, stop, redeploy, upgrade, and recover.
- Unified resource operations: terminal, file, service diagnostics, and container operations from one operator surface.
- Operational visibility: app and platform health, logs, events, and status views.
- Runtime configuration assets: IaC workspace, shared envs, credentials, certificates, and required runtime settings.

### Growth (Post-MVP)

- Coordinated multi-server app topology, including role-aware or failover-oriented operation paths.
- Incident response and deterministic operations automation.
- AI workflow automation, embedded assistance expansion, and edition-based advanced capabilities.

### Out of Scope (This Revision)

- Full cluster orchestration or Kubernetes management.
- Deep CI/CD platform workflows.
- Enterprise organization, billing, and contract operations beyond edition and entitlement basics.

## User Journeys

### Journey 1: Execute Core App Lifecycle Action

1. User selects a target app and chooses an action such as start, stop, redeploy, or upgrade.
2. System requests confirmation before execution.
3. System executes or schedules the operation and returns status.
4. User sees success or failure with next-step guidance.

### Journey 2: Manage Runtime Configuration Assets

1. User opens the relevant configuration surface such as IaC Browser, shared envs, or runtime settings.
2. User updates the required configuration or credential asset.
3. System validates format and applies or stores the change safely.
4. User receives explicit apply or save results.

### Journey 3: Operate Resources from One Surface

1. User opens terminal, files, services, or container operations for a target environment.
2. User performs the required inspection or action.
3. System executes the action and returns output or state.
4. User continues without switching to unrelated tools.

### Journey 4: Diagnose App or Platform State

1. User opens an app or platform status view.
2. User reviews health, recent events, task state, and logs.
3. User identifies the failed component or degraded state.
4. User decides the next action using the returned context.

## Project-Type Requirements

- Single-server first: all flows must work without cluster dependencies.
- GitOps aligned: configuration changes remain auditable and reproducible.
- Domain-oriented: product modules may span domains, but domain boundaries remain the primary modeling boundary.
- Technology-neutral presentation in public docs.
- Safe operations: destructive actions require explicit confirmation.

## Functional Requirements

### FR-1 Application Lifecycle Actions

- Users can perform core lifecycle actions for a managed app.
- The system requires explicit confirmation before destructive or high-risk actions.
- The system returns operation state such as pending, success, failed, or attention required.

### FR-2 Resource Operations Surface

- Users can access terminal, file, service, and container operations from one product surface.
- The system supports both local and remotely managed targets.
- The system returns command output, state, or error detail appropriate to the selected operation.

### FR-3 Runtime Configuration Assets

- Users can manage runtime configuration assets such as registry settings, proxy settings, shared envs, IaC files, and credentials.
- The system validates and persists each asset safely.
- The system reports explicit save, apply, or validation results.

### FR-4 Operational Visibility

- Users can inspect app and platform health from product surfaces.
- Users can view recent logs, events, and task status for diagnosis.
- The system supports basic filtered views for common diagnostic paths.

## Non-Functional Requirements

- Operation response: restart/stop command acknowledgement within 3 seconds.
- Reliability: lifecycle and settings operations are idempotent for repeated submissions.
- Observability: every operation stores timestamp, actor, target, and result.
- Security: sensitive setting values are protected at rest and never fully exposed in UI.
- Compatibility: MVP supports Ubuntu 20.04+, Debian 11+, and Rocky Linux 8+.
