# Epic 6: Components

## Objective

Create a unified `System / Components` workspace for system administrators to inspect installed components and active runtime services in one place, while preserving service operations as a dedicated tab inside the page.

## Scope

- Single entry under `System`: `Components`
- One information page at `/components`
- Two tabs inside the page:
	- `Installed Components`
	- `Active Services`
- First phase focuses on inventory, runtime visibility, and log-first diagnostics
- Vulnerability scanning, EOL intelligence, and upgrade recommendations remain out of scope for this epic

## Stories

### 6.1 Components Inventory

- Aggregate a normalized component list for AppOS runtime components
- Display at minimum: `name`, `version`, `available`, `last_detected_at`
- Keep the presentation minimal and admin-facing
- Present installed components as a non-operational, text-first layout (name + version + time), with high-density responsive columns (up to five columns on wide desktop)
- Provide empty, loading, and partial-detection states
- Responsive layout for desktop and mobile admin usage

### 6.2 Active Services

- Fetch all supervisord-managed internal services via backend routes under `/api/components/services`
- Display: service name, state, PID, uptime, CPU%, memory, and last refresh time
- Provide state indicators and summary counts for total, running, stopped, and error services
- View stdout and stderr logs per service in a modal dialog
- Support auto-refresh with configurable interval and manual refresh
- Keep dangerous service operations disabled by default in the MVP UI

### 6.3 Components Page

- Create a single page under `System / Components` with two tabs:
	- `Installed Components`
	- `Active Services`
- Keep the installed components tab intentionally simple: no category grouping, no search, no summary statistics
- Keep the status-route embedded tabs intentionally simple: remove search controls and remove table outer borders to lower operational pressure
- Preserve direct access to service operations inside the `Active Services` tab without requiring a separate sidebar entry
- Keep terminology admin-friendly and avoid exposing SBOM jargon in the primary UI

### 6.4 Detection Pipeline

- Define a backend aggregation layer that merges multiple detection sources into one component inventory model
- Use one backend-owned YAML metadata registry as the master data source for supported components, probes, logs, and future operation policy
- Record detection provenance so later features can attach vulnerability, upgrade, or compliance data to the same component records
- Ensure the model can represent components that have no running service and services that do not deserve first-class component exposure

## Story Artifacts

- `story6.1-components-inventory.md`
- `story6.2-active-services.md`
- `story6.3-components-page.md`
- `story6.4-detection-pipeline.md`

## Acceptance Criteria

- [ ] Components page accessible at `/components` under the `System` menu
- [ ] Page contains exactly two primary tabs: `Installed Components` and `Active Services`
- [ ] Installed Components tab shows a simple read-only component view with name, version, and detection/update time
- [ ] Active Services tab shows supervisord-managed internal services with correct runtime state
- [ ] Active Services tab provides logs and diagnostics without exposing dangerous controls by default
- [ ] Installed Components tab remains minimal, non-operational in tone, and does not require category grouping, search, or statistics
- [ ] UI uses shadcn/ui + Tailwind, consistent with Dashboard design system
- [ ] Proper auth: all API calls go through PB unified auth
- [ ] Error handling covers full failure and partial-detection scenarios
- [ ] Responsive on mobile

## Key Technical Decisions

**Information architecture**:
```
System
└── Components (/components)
		├── Tab: Installed Components
		└── Tab: Active Services
```

**Data flow**:
```
Dashboard → PB JS SDK (pb.send) → backend `/api/*` routes → component aggregation layer
																							├── build metadata / Docker image manifest
																							├── runtime commands
																							└── supervisord XML-RPC + system commands
```

**Backend approach**: Use a hybrid inventory model. Standardized supply-chain metadata is the preferred long-term source for installed components. Runtime command detection and supervisord APIs supplement missing or runtime-specific data. Epic 6 target APIs live under `/api/components*` and must not use the deprecated `/api/ext/*` prefix.

**Service monitoring**: XML-RPC remains the primary interface for supervisord operations. CLI sampling remains an acceptable supplement for process CPU and memory where XML-RPC is insufficient.

**Frontend location**: `dashboard/src/routes/_app/_auth/components.tsx` or equivalent file-based route for `/components`

## Initial Component Inventory Baseline

Initial components inferred from `build/Dockerfile` and `build/Dockerfile.local`:

| Component | Notes |
|-----------|-------|
| AppOS backend (`appos`) | Go binary built from `backend/cmd/appos`; PocketBase-based framework |
| AppOS dashboard | Static frontend built from `dashboard/` |
| Nginx | Serves dashboard and proxies API |
| Supervisor | Starts and manages internal services |
| Redis | Internal cache / runtime dependency |
| Terraform CLI | Pulled from `hashicorp/terraform:1.14` |
| Docker CLI | Used for local Docker operations |
| Docker Compose CLI plugin | Compose operations via Docker CLI |
| Node.js | Installed in runtime image |
| npm | Installed in runtime image |
| Pi Coding Agent (`@mariozechner/pi-coding-agent`) | Installed globally in image |
| Store Library plugin | Unzipped to `/appos/library` |
| Alpine Linux base image | Runtime foundation |

These entries form the first-pass inventory baseline. The user-facing page can remain simpler than this internal baseline and only needs to show name, version, and availability.

## Integration Notes

- **Depends on**: Epic 7 (Dashboard framework — routing, layout, PB SDK integration)
- **Backend**: backend `/api/components*` routes wrap both component aggregation and service operations; supervisord XML-RPC stays on localhost:9001, only PB process accesses it
- **Auth**: PB unified auth middleware — no direct frontend-to-supervisord access
- **Boundary with Epic 4**: Epic 4 manages user-deployed Docker applications. Epic 6 covers AppOS system components and AppOS internal runtime services.
- **Migration note**: Existing `Services` page behavior becomes the `Active Services` tab within the new Components workspace
