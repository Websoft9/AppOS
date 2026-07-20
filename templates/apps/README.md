## AppOS Normalized Templates

This folder holds AppOS-owned normalized templates.

Each app directory here should satisfy the contract defined by Story 32.1 and may be produced or maintained through the adaptation model defined by Story 32.2.

These are reusable template-layer assets. They are not instance declarations and not runtime workspaces.

Expected contents for one template directory are minimal and explicit:

- `manifest.json`
- `inputs.schema.json`
- `render.json`
- `source.json`
- `compose/`
- `env/`
- optional supporting `files/`

This folder is not the upstream source mirror and not the rendered install output location.

It should contain:

- official template baselines normalized into the AppOS contract
- custom reusable templates derived by users or later platform flows

It should not be treated as:

- the control-plane instance declaration store
- the managed-server runtime workspace

Related folders:

- `templates/upstream/` preserves upstream references and import metadata
- `templates/adapters/` records adaptation rules and review metadata
- `templates/tests/` records validation baselines and sample regression artifacts

