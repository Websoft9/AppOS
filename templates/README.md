## Templates Overview

The `templates/` tree is the source workspace for AppOS template engineering.

This workspace models four different concerns that must not be collapsed together.

### 1. Official Template Seed

Platform-provided baseline templates intended for reuse and distribution.

In the repository, these are authored and reviewed under the `templates/` source tree.
At runtime, they should map to a read-only image-shipped seed plus an online-update cache strategy defined by Epic 32.

### 2. Custom Template

User-authored or user-derived reusable templates.

These remain template-layer assets. They are not concrete instance state and are intended for future reuse.

### 3. Instance Declaration

The control-plane normalized declaration for one concrete deployment instance.

This is not stored under the repository `templates/` source tree. It is the later runtime/control-plane output of template resolution.

### 4. Runtime Workspace

The rendered execution directory pushed to a managed server and consumed by Docker Compose or equivalent runtime tooling.

This is also not the same thing as the repository template source.

## Source Tree Roles

- `templates/apps/`: normalized reusable templates
- `templates/upstream/`: upstream source metadata or imported references
- `templates/adapters/`: adaptation rules and review metadata
- `templates/tests/`: validation and regression baselines
- `templates/tools/`: local validation and preview tooling

## Design Rule

Template source, instance declaration, and runtime workspace are different layers and should stay different in both specs and implementation.