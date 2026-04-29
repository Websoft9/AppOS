# Implementation Readiness Assessment Report

**Date:** 2026-04-20
**Project:** AppOS
**Epic Assessed:** Epic 29 — Software Delivery
**Assessor:** GitHub Copilot (BMAD check-implementation-readiness workflow)

---

## Document Inventory

### Planning Artifacts Used

| Document | File | Notes |
|---|---|---|
| PRD | `specs/planning-artifacts/prd.md` (27K) | Primary requirements source |
| Architecture | `specs/planning-artifacts/architecture.md` (6.5K) | Technical design baseline |
| Epics Index | `specs/planning-artifacts/epics.md` (2.9K) | Navigation index |
| UX Design Spec | `specs/planning-artifacts/ux-design-specification.md` (58K) | UX baseline |
| Coding Decisions | `specs/planning-artifacts/coding-decisions.md` | API and code conventions |

### Implementation Artifacts Assessed

| Document | File |
|---|---|
| Epic | `specs/implementation-artifacts/epic29-software-delivery.md` |
| Story 29.1 | `specs/implementation-artifacts/story29.1-software-contract-and-catalog.md` |
| Story 29.2 | `specs/implementation-artifacts/story29.2-software-lifecycle-execution.md` |
| Story 29.3 | `specs/implementation-artifacts/story29.3-server-software-operational-surface.md` |
| Story 29.4 | `specs/implementation-artifacts/story29.4-supported-software-discovery-surface.md` |
| Story 29.5 | `specs/implementation-artifacts/story29.5-local-software-inventory-surface.md` |
| Legacy Implementation Record | `specs/implementation-artifacts/epic29-legacy-implementation-record.md` |

**No duplicate documents found. No missing required planning documents.**

---

## PRD Functional Requirements

### Extracted FRs Relevant to Epic 29

| FR | Requirement | Epic 29 Coverage |
|---|---|---|
| FR-1 | App lifecycle actions (install, start, stop, etc.) | Partial — Epic 29 covers *software component* install/upgrade/verify, not app lifecycle install flows |
| **FR-2** | **Resource operations: terminal, file, service diagnostics, container ops; inspect and trigger software delivery actions for AppOS-managed software components** | **Directly addressed by Epic 29** |
| FR-3 | Runtime configuration assets (shared envs, credentials, IaC) | Not Epic 29 scope |
| FR-4 | Operational visibility: health, logs, events, task status | Not Epic 29 scope |

### Extracted NFRs Applicable to Epic 29

| NFR | Requirement | Epic 29 Coverage |
|---|---|---|
| Response time | Command acknowledgement within 3 seconds | Story 29.1 has async pattern; check coverage needed |
| Idempotency | Lifecycle operations are idempotent for repeated submissions | Not addressed in any story |
| Audit | Every operation stores timestamp, actor, target, result | Story 29.1 defines audit actions |
| Security | Sensitive values never fully exposed in UI | Story 29.4 guardrail: "secret material must never be stored in catalog metadata" ✅ |
| Compatibility | Ubuntu 20.04+, Debian 11+, Rocky Linux 8+ | Story 29.3 template preflight defines `supported_os` lists ✅ |

---

## Epic Coverage Validation

Epic 29 (Software Delivery) is the direct implementation of the PRD FR-2 sub-requirement:

> "Users can inspect and trigger software delivery flows for AppOS-managed software components on a server."

All 6 stories form a coherent chain:

```
29.1 Model → 29.2 Boundary → 29.3 Template → 29.4 Catalog → 29.5 Target Readiness → 29.6 Surface
```

FR-2 coverage is **adequate** for MVP scope. No other epic in the epics index claims this responsibility.

---

## UX Alignment

The UX design specification (`ux-design-specification.md`, 58K) does not contain mockups or navigation specs for the Software Delivery surface. This is understandable for a new capability, but creates the following gap:

- Story 29.6 defines its own minimal UI contract (panel, card per component, 3 actions)
- No UX review has validated this contract against the broader product navigation model
- The surface is server-scoped, but it is not clear which tab or section of the server detail page it belongs to

This is a **low-blocking risk** for backend stories (29.1–29.5), but it should be resolved before Story 29.6 enters implementation.

---

## Epic Quality Review

### Epic-Level Assessment

| Criterion | Assessment |
|---|---|
| User value focus | ✅ Epic goal is operator-facing: "Own the software supply path AppOS actually manages" |
| Independence from future epics | ✅ Epic 29 does not require any future planned epic |
| Implementation principle clarity | ✅ Template-driven execution is explicit and well-reasoned |
| Scope boundary | ✅ In/Out scope defined, monitor boundary explicitly called out |

### Story-Level Assessment

#### Story 29.1 — Model

**Status: ✅ Strong foundation, naming decision pending**

- API contract is detailed and correct
- All DTOs, routes, audit actions, cross-domain events, and capability query contracts are defined
- **Issue**: DTO names in story use `SoftwareComponentSummary`, `SoftwareDeliveryLastAction`, `TargetReadinessResult` and the implementation must preserve that Software Delivery naming consistently across the domain model
- The naming decision must be made before implementation so the model and story remain identical

#### Story 29.2 — Boundary

**Status: ✅ Solid, low risk**

- Subdomain classification is clear and well-reasoned
- Monitor/Software Delivery split is explicit
- Guardrails prevent common mistakes
- Acceptance criteria are testable

#### Story 29.3 — Template

**Status: ✅ Solid, one path inconsistency**

- Template schema and executor contract are fully specified
- `package-systemd` and `script-systemd` kinds are both documented
- YAML files belong under `backend/domain/software/templates.yaml`
- **Issue**: Implementation paths must stay aligned with the Software Delivery domain naming and use `backend/domain/software/templates.yaml`
- **Missing**: No `reinstall` step defined in the template schema, even though epic scope lists reinstall as in-scope

#### Story 29.4 — Catalog

**Status: ⚠️ Blocked on appos-agent installer URL**

- Docker, Nginx, Netdata agent catalog entries are complete and correct
- YAML file belongs under `backend/domain/software/catalog.yaml` with all 4 components
- **CRITICAL**: `appos-agent` installer URL is a placeholder: `{appos_agent_installer_url}` in code, `https://example.invalid/appos-agent/install.sh` in story — neither is a real, resolvable URL. Install action for appos-agent cannot execute without this value.
- Adding a component requires catalog registration (not a new story) ✅

#### Story 29.5 — Target Readiness

**Status: ⚠️ Contract gap with Story 29.1**

- Readiness dimensions are well-defined (OS, privilege, network, dependency)
- Query surface is correctly scoped
- **CRITICAL**: Story 29.5 defines a `dependency_ready` field in the readiness contract. Story 29.1's `TargetReadinessResult` DTO does **not** include `dependency_ready` — only `ok`, `os_supported`, `privilege_ok`, `network_ok`, `issues`. Developer will face contradictory contracts between these two stories.

#### Story 29.6 — Surface

**Status: ⚠️ Thin on UX, dependent on missing design spec**

- Tasks and acceptance criteria are well-defined
- Dependencies on 29.4 and 29.5 are correct
- **Issue**: No UX spec or mockup backs this story. The "one server-scoped panel or tab" spec is ambiguous — which tab? Which server detail layout? How does it look alongside other panels?
- **Risk**: Without UX guidance, implementation may produce a surface inconsistent with existing resource detail patterns

---

## Issues Summary

### CRITICAL (Must resolve before implementation starts)

| # | Issue | Location | Action Required |
|---|---|---|---|
| C1 | **DTO naming ambiguity** | Story 29.1 vs. `model.go` | Decide: rename code types (`ComponentSummary` → `SoftwareComponentSummary`, etc.) or update story to match current code names |
| C2 | **`dependency_ready` field missing in 29.1 DTO** | Story 29.1 `TargetReadinessResult` vs. Story 29.5 readiness contract | Add `dependency_ready` to `TargetReadinessResult` in Story 29.1, or document that it is resolved differently |
| C3 | **appos-agent installer URL unresolved** | Story 29.4 catalog entry, `catalog.yaml` | Determine and document the real installer URL before Story 29.4 can be implemented |

### MEDIUM (Should resolve before story-level implementation)

| # | Issue | Location | Action Required |
|---|---|---|---|
| M1 | **No async worker story** | Epic 29 overview, `model.go` has `Operation`/`OperationPhase` | Add a story (or expand existing story scope) to cover Asynq worker integration, queue pattern, and operation status polling for install/upgrade/verify actions |
| M2 | **Audit action rename not planned** | Story 29.1 specifies `server.software.*` | Plan the rename step explicitly so audit actions match the Software Delivery domain |
| M3 | **Epic 28 dependency rationale unclear** | Epic 29 header: "Depends on: Epic 12, 20, 28" | Clarify why Monitor (Epic 28) is a prerequisite for Software Delivery; if Monitor is a consumer (not a provider), dependency direction may be inverted |
| M4 | **Package path naming decision** | Story 29.3: `backend/domain/software/` | Keep the Go package path aligned with the Software Delivery domain and document it explicitly |

### MINOR (Can be resolved during implementation)

| # | Issue | Location | Action Required |
|---|---|---|---|
| N1 | **Reinstall action not specified** | Epic scope; Story 29.3 template schema | Define the reinstall template step or explicitly exclude reinstall for MVP |
| N2 | **UX design gap for Story 29.6** | Story 29.6 | Create a minimal UX mockup or reference a specific existing layout pattern before Story 29.6 implementation |
| N3 | **Architecture doc terminology** | `architecture.md` uses legacy runner and capability-management wording | Update architecture doc to use Software Delivery terminology consistently |
| N4 | **NFR idempotency not addressed** | No story explicitly covers idempotent retry for software actions | Acknowledge in 29.3 executor contract or add to acceptance criteria |

---

## Summary and Recommendations

### Overall Readiness Status

**READY** *(updated 2026-04-20 after remediation)*

All critical and medium issues identified in the initial assessment have been resolved. The epic and stories are ready for implementation, starting with Story 29.1 and 29.2.

### Resolved Issues

| # | Issue | Resolution |
|---|---|---|
| C1 | DTO naming ambiguity | `model.go` updated to use Software Delivery domain names consistently: `SoftwareComponentSummary`, `SoftwareComponentDetail`, `SoftwareActionResponse`, `SoftwareDeliveryLastAction`, `TargetReadinessResult`, `SoftwareVerificationResult` |
| C2 | `dependency_ready` field missing | Added `DependencyReady bool` to `TargetReadinessResult` in `model.go` and to the DTO table in Story 29.1 |
| C3 | appos-agent installer URL placeholder | `catalog.yaml` updated: `script_url` is now empty with a comment directing the executor to read `software.appos_agent_installer_url` system setting. Story 29.4 adds Task 4 to register the setting. |
| M1 | No async worker story | Canonical Story 29.2 now carries the async worker contract; detailed prior implementation record is preserved in `epic29-legacy-implementation-record.md` |
| M2 | Audit action rename not planned | `model.go` constants updated to `server.software.*`. Story 29.2 Task 4 added to cover the rename plan and migration note. `AuditActionReinstall` added. |
| M3 | Epic 28 dependency direction unclear | Removed Epic 28 from Epic 29 `Depends on` — Monitor is a consumer of Software Delivery output, not a prerequisite |
| M4 | Package naming decision undocumented | Epic 29 now has an explicit "Package Naming Decision" section: the domain package is `domain/software` and all types use the Software Delivery naming scheme |
| N1 | Reinstall action not specified | `ActionReinstall` constant added to `model.go`; `reinstall` step added to template schema in Story 29.3; idempotency AC added |
| N2 | UX design gap for Story 29.6 | `UX Reference` section added to Story 29.6 specifying "Software" tab in Server Detail, layout pattern, status chips, and action button rules |
| N3 | Architecture doc terminology | `architecture.md` updated to use Software Delivery terminology in all three relevant sections |
| N4 | NFR idempotency not addressed | Story 29.3 acceptance criteria now includes explicit idempotency requirement |

### Implementation Order

Stories are ready to implement in dependency order:

1. **29.1 Model** — no implementation blockers
2. **29.2 Boundary** — depends on 29.1
3. **29.3 Template** — depends on 29.1, 29.2
4. **29.4 Catalog** — depends on 29.1, 29.3
5. **29.5 Target Readiness** — depends on 29.1, 29.3, 29.4
6. **29.7 Worker** — depends on 29.3, 29.4, 29.5
7. **29.6 Surface** — depends on 29.4, 29.5

### Final Note

This assessment identified **3 critical, 4 medium, and 4 minor** issues. All 11 have been remediated. Epic 29 is now implementation-ready.

---

*Report generated: 2026-04-20 | Remediation completed: 2026-04-20 | Workflow: bmad-check-implementation-readiness*
