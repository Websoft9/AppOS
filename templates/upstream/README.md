## Template Upstream Sources

This folder preserves upstream references or imported upstream assets for AppOS templates.

Purpose:

- keep upstream source identity separate from AppOS-normalized templates
- support semantic diff and upgrade review
- avoid collapsing upstream and AppOS adaptation into one mutable folder

This folder is not the active normalized template contract, not the control-plane instance declaration store, and not the runtime workspace.

Active normalized templates live under `templates/apps/`.
