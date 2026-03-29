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
---

# Product Requirements Document - AppOS

**Author:** AppOS  
**Date:** 2026-02-28  
**Version:** 1.1

## Executive Summary

AppOS is an intelligent app operations and lifecycle platform, single-server first and designed to evolve toward coordinated multi-server operation for one logical application.  
This PRD revision defines a minimal capability baseline for that positioning: application lifecycle control, unified resource operations, operational visibility, and safe runtime configuration.  
The MVP focuses on four operator outcomes: execute core lifecycle actions, operate remote and local resources from one surface, inspect app and platform health, and manage configuration or credential assets safely.  
The document remains intentionally concise and capability-oriented for downstream UX, architecture, and epic decomposition.

## Domain, Product Module, and Object Mapping

This table separates three concepts that were previously mixed together:

- `Domain / Subdomain`: business capability boundary
- `Product Module`: user-facing feature entry
- `Status`: current delivery state of the module projection
- `Objects`: candidate model concepts inside that capability

| Domain | Subdomain | Product Module | Status | Candidate Objects |
| --- | --- | --- | --- | --- |
| Application Lifecycle | App Instance Management | Apps, Installed Apps, App Detail | Current | `AppInstance`, `AppSummary`, `DesiredState` |
| Application Lifecycle | Operation Management | Actions, Operations, Operation Detail, Operation Timeline | Current | `OperationJob`, `OperationLog`, `OperationOutcome` |
| Application Lifecycle | Release Management | Releases, Current Release, Release History | Current | `ReleaseSnapshot`, `ReleaseRole`, `ReleaseDiff` |
| Application Lifecycle | Exposure Management | Exposures, Domains, Publication Detail | Current + Planned | `Exposure`, `DomainBinding`, `PublicationState` |
| Application Lifecycle | Recovery Management | Backup, Restore, Rollback, Recover | Current + Planned | `RecoveryPlan`, `RollbackPoint`, `RecoveryOutcome` |
| Application Lifecycle | Application Topology & Coordination | App Topology, Node Roles, Failover View | Planned | `AppTopology`, `DeploymentUnit`, `NodeAssignment` |
| Lifecycle Execution | Pipeline Execution | Pipelines, Pipeline Detail | Current | `PipelineRun`, `PipelineNodeRun`, `PipelinePhase` |
| Lifecycle Execution | Worker Scheduling | No standalone module; surfaced through operation status | Internal | `WorkerClaim`, `ExecutionSlot`, `QueueState` |
| Lifecycle Execution | Projection Update | No standalone module; surfaced through app and operation projections | Internal | `ProjectionTarget`, `ProjectionVersion`, `ProjectionState` |
| Lifecycle Execution | Compensation Control | Compensation Timeline, Retry / Resume Controls | Planned | `CompensationPlan`, `CompensationStep`, `ResumeToken` |
| Resource Operations Platform | Remote Access | Tunnels, Servers, Connect | Current | `Server`, `TunnelEndpoint`, `TunnelSession` |
| Resource Operations Platform | Terminal Operations | Terminal, Server Shell | Current | `TerminalSession`, `ExecSession`, `ShellProfile` |
| Resource Operations Platform | File Operations | Server Files, SFTP, File Browser | Current | `RemoteFile`, `TransferJob`, `DirectoryEntry` |
| Resource Operations Platform | Service Operations | Components, Services, Service Logs, Systemd Diagnostics | Current | `ServiceStatus`, `ServiceLogView`, `ServiceAction` |
| Resource Operations Platform | Container Operations | Docker, Containers, Compose, Exec | Current | `ContainerRef`, `ComposeProject`, `ContainerAction` |
| Observability | Telemetry | Metrics, Logs, Events, Container Stats | Current | `MetricSeries`, `LogEntry`, `PlatformEvent` |
| Observability | Health & Diagnostics | Health, Diagnostic Views, App Health, Connectivity Checks | Current + Planned | `HealthSummary`, `DiagnosticSignal`, `CheckResult` |
| Observability | Platform Self-Observation | AppOS Status, Active Services, System Crons | Current + Planned | `ComponentStatus`, `ServiceStatus`, `CronStatus` |
| Operations Management | Resource Topology | Groups | Current | `Group`, `GroupItem`, `ResourceReference` |
| Operations Management | Operational Knowledge | Topics | Current | `Topic`, `TopicPost`, `TopicReference` |
| Operations Management | Operational Knowledge | Space | Current | `KnowledgeDocument`, `KnowledgeFolder`, `Attachment` |
| Operations Management | Incident Response | Alerts, Incidents, Notification Rules, Incident Timeline | Planned | `Incident`, `AlertRule`, `EscalationPolicy` |
| Operations Management | Operations Automation | Operational Procedures, Script Library, Scheduled Jobs | Current + Planned | `Procedure`, `ProcedureStep`, `ProcedureRun` |
| App Catalog | Catalog Apps | Store, Catalog, App Listing | Current | `CatalogApp`, `CatalogCategory`, `CatalogFilter` |
| App Catalog | Custom Apps | Custom Apps, Private Templates | Current | `CustomApp`, `CustomAppSource`, `CustomAppVisibility` |
| App Catalog | Templates | Install Templates, Compose Templates, Starter Blueprints | Current + Planned | `Template`, `TemplateVersion`, `TemplateInput` |
| App Catalog | Favorites / Notes | Favorites, Store Notes | Current | `Favorite`, `CatalogNote`, `UserCatalogState` |
| Runtime Infrastructure | Runtime Execution | Docker / Compose Runtime, Compose Config | Current | `RuntimeProject`, `ComposeSpec`, `RuntimeAction` |
| Runtime Infrastructure | Recovery Assets | Backups, Restore Artifacts | Current | `BackupSnapshot`, `BackupArtifact`, `RestoreRequest` |
| Runtime Infrastructure | Configuration Assets | IaC Workspace, IaC Browser, Shared Envs, Runtime Settings | Current + Planned | `IaCWorkspace`, `IaCFile`, `SharedEnvSet` |
| Gateway Management | Domain Binding | Domains, Gateway Domains, App Exposure Bindings | Current + Planned | `DomainBinding`, `Hostname`, `BindingScope` |
| Gateway Management | Routing & Upstreams | Proxy, Route Config, Upstream Targets, Gateway Routes | Current + Planned | `GatewayRoute`, `UpstreamTarget`, `BackendRef` |
| Gateway Management | Certificate Binding | SSL, TLS Bindings, Certificate Attachments | Current + Planned | `CertificateBinding`, `TlsPolicy`, `CertificateRef` |
| Gateway Management | Gateway Policies | Publish Policies, Routing Policies, Access Rules | Planned | `GatewayPolicy`, `RoutingPolicy`, `PublishConstraint` |
| Gateway Management | Gateway Views | Gateway Overview, Domain View, Route Inventory | Planned | `GatewayView`, `RouteInventoryItem`, `BindingSummary` |
| Integrations & Connectors | Source Integrations | Git Sources, Source Connectors | Planned | `SourceConnector`, `RepositoryBinding`, `SourceCredentialRef` |
| Integrations & Connectors | Artifact & Registry Integrations | Registries, Artifact Sources, Registry Settings | Current + Planned | `RegistryConnector`, `ArtifactSource`, `RegistryCredentialRef` |
| Integrations & Connectors | Notification Integrations | Email Channels, Webhooks, Chat Connectors | Planned | `NotificationConnector`, `DeliveryChannel`, `NotificationEndpoint` |
| Integrations & Connectors | AI Provider Integrations | LLM Providers, Model Connectors | Current + Planned | `AIProvider`, `ModelEndpoint`, `ProviderCredentialRef` |
| Integrations & Connectors | External Secret / Identity Integrations | External Secret Backends, SSO, Identity Bridges | Planned | `ExternalSecretProvider`, `IdentityConnector`, `FederationBinding` |
| AI Workflow / Agent Automation | Skills | Skills Library | Planned | `Skill`, `SkillCapability`, `SkillInputSchema` |
| AI Workflow / Agent Automation | Task Plans | Task Plan Builder, Planned Workflows | Planned | `TaskPlan`, `TaskStep`, `TaskConstraint` |
| AI Workflow / Agent Automation | Guided Automation | Guided Ops Flows, AI-Assisted Runbooks | Planned | `GuidedFlow`, `AutomationContext`, `FlowCheckpoint` |
| AI Workflow / Agent Automation | Domain-Specific Agents | Specialized Agents, Copilot Actions | Planned | `AgentProfile`, `AgentTask`, `AgentResult` |
| Edition & Entitlement | Edition Model | Edition Overview, Plan Comparison | Planned | `Edition`, `EditionCapabilitySet`, `EditionRule` |
| Edition & Entitlement | License Activation | License Center, Activation Flow | Planned | `License`, `ActivationRecord`, `LicenseFingerprint` |
| Edition & Entitlement | Subscription State | Subscription Status, Renewal State | Planned | `Subscription`, `SubscriptionState`, `ExpiryWindow` |
| Edition & Entitlement | Feature Entitlements | Entitlement Summary, Feature Availability | Planned | `Entitlement`, `CapabilityFlag`, `UsageLimit` |
| Platform Configuration | Platform Configuration | Settings, Settings Schema, Settings Entries | Current | `SettingEntry`, `SettingSchema`, `SettingScope` |
| Identity and Access | Identity and Access | Setup, Auth, Users, Access Control | Current + Planned | `User`, `Session`, `AccessGrant` |
| Security and Secret Management | Secrets | Credentials, Secrets, Secret Reveal / Resolve | Current | `Secret`, `SecretPayload`, `SecretUsage` |
| Security and Secret Management | Secret Policies | Secret Policies, Reveal Rules, Access Modes | Current + Planned | `SecretPolicy`, `AccessMode`, `RevealRule` |
| Audit and Policy | Audit and Policy | Audit Log, Policy Events, Compliance Views | Current + Planned | `AuditEntry`, `PolicyDecision`, `PolicyEvent` |
| AI Assistant | Suggestion | Embedded Copilot Suggestions | Planned | `Suggestion`, `SuggestionContext`, `SuggestionAction` |
| AI Assistant | Explanation | Explain This, Failure Explanation | Planned | `Explanation`, `ExplanationSource`, `ReasoningNote` |
| AI Assistant | Guidance | Guided Help, Contextual Recommendations | Planned | `GuidanceCard`, `GuidanceStep`, `Recommendation` |
| AI Assistant | Contextual Help | Inline Help, Smart Hints | Planned | `HelpHint`, `ContextAnchor`, `HelpTopic` |
| AI Assistant | Embedded Copilot Experience | Global Assistant, In-Page Assistant | Planned | `AssistantSession`, `AssistantIntent`, `AssistantResponse` |

Rules:

- Domains and subdomains should stay stable.
- Product modules may change with UX and navigation.
- One product module may map to multiple rows when it projects capabilities from multiple domains.
- The table should cover all domains and subdomains, even when a subdomain has no standalone module yet.
- Shared gateway and integration capabilities should appear as their own domains instead of being hidden inside generic runtime settings.
- Objects belong to the model, not to the menu.

## Success Criteria

- Core lifecycle actions return accepted status within 3 seconds and complete successfully in ≥ 95% of supported cases.
- Operators can reach terminal, file, container, or service operations for a managed target within 10 seconds.
- Runtime configuration assets such as shared envs, registry settings, proxy settings, and credentials can be saved and applied with explicit success or failure status in ≤ 30 seconds.
- App and platform status surfaces expose recent health, logs, and task state within 10 seconds for common diagnostic paths.
- Failed operations return actionable state, error reason, and next-step guidance.

## Product Scope

### MVP

- Application lifecycle actions: install, start, stop, redeploy, upgrade, and recover for single-server-first app operations.
- Unified resource operations: terminal, file operations, service diagnostics, and container operations from one operator surface.
- Operational visibility: app and platform health, logs, events, and status views for normal operations and diagnosis.
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
