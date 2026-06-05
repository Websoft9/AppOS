#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_APPS_DIR = ROOT / "templates" / "apps"
PLACEHOLDER_PATTERN = re.compile(r"\$\{([^}]+)\}")


class RenderError(Exception):
    pass


def load_json(path: Path) -> dict:
    return json.loads(path.read_text())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render a sample template ingress payload")
    parser.add_argument("template", nargs="?", default="wordpress", help="Template key to render")
    parser.add_argument("--values", help="Optional JSON file providing input overrides")
    return parser.parse_args()


def load_template(template_key: str) -> tuple[dict, dict, dict, dict]:
    template_dir = TEMPLATES_APPS_DIR / template_key
    if not template_dir.exists():
        raise RenderError(f"template not found: {template_key}")
    manifest = load_json(template_dir / "manifest.json")
    inputs = load_json(template_dir / "inputs.schema.json")
    render = load_json(template_dir / "render.json")
    source = load_json(template_dir / "source.json")
    return manifest, inputs, render, source


def build_input_values(inputs_schema: dict, override_path: str | None) -> dict:
    values = {}
    for field in inputs_schema.get("fields", []):
        values[field["key"]] = field.get("default")

    if override_path:
        override_data = load_json(Path(override_path))
        values.update(override_data)

    return values


def resolve_expression(expression: str, values: dict, secret_refs: list[dict]) -> str:
    def replace(match: re.Match[str]) -> str:
        token = match.group(1)
        if token.startswith("secret:"):
            secret_key = token.split(":", 1)[1]
            secret_refs.append({"input": secret_key, "ref": f"secret://{secret_key}"})
            return f"secret://{secret_key}"

        if token.startswith("platform."):
            platform_key = token.split(".", 1)[1]
            platform_defaults = {
                "network": "websoft9",
            }
            if platform_key not in platform_defaults:
                raise RenderError(f"unsupported platform placeholder: {token}")
            return str(platform_defaults[platform_key])

        if token not in values:
            raise RenderError(f"unknown input placeholder: {token}")
        value = values[token]
        if value is None:
            return ""
        return str(value)

    return PLACEHOLDER_PATTERN.sub(replace, expression)


def render_env_map(render: dict, values: dict) -> tuple[dict, list[dict]]:
    secret_refs: list[dict] = []
    env = {}
    for key, value in render.get("env", {}).items():
        env[key] = resolve_expression(value, values, secret_refs)

    unique_secret_refs = []
    seen = set()
    for ref in secret_refs:
        marker = (ref["input"], ref["ref"])
        if marker in seen:
            continue
        seen.add(marker)
        unique_secret_refs.append(ref)
    return env, unique_secret_refs


def build_payload(template_key: str, manifest: dict, inputs_schema: dict, render: dict, source: dict, values: dict) -> dict:
    env, secret_refs = render_env_map(render, values)

    input_summary = []
    for field in inputs_schema.get("fields", []):
        key = field["key"]
        item = {
            "key": key,
            "type": field["type"],
            "storageMode": field["storage_mode"],
            "value": None if field["storage_mode"] == "secret_backed" else values.get(key),
        }
        if field["storage_mode"] == "secret_backed":
            item["secretRef"] = f"secret://{key}"
        input_summary.append(item)

    return {
        "template": {
            "key": template_key,
            "contractVersion": manifest.get("contractVersion"),
            "templateRevision": source.get("template_revision"),
            "originKind": source.get("origin_kind"),
            "originRef": source.get("origin_ref"),
        },
        "ingress": {
            "mode": "template",
            "candidateInputs": input_summary,
            "serviceRoles": manifest.get("serviceRoles", {}),
        },
        "normalizedIntent": {
            "appId": values.get("app_id"),
            "version": values.get("version"),
            "primaryService": render.get("compose_values", {}).get("primaryService"),
            "databaseService": render.get("compose_values", {}).get("databaseService"),
            "exposures": render.get("exposures", []),
            "source": {
                "kind": "template",
                "templateKey": template_key,
                "templateRevision": source.get("template_revision"),
            },
        },
        "renderedArtifacts": {
            "env": env,
            "composeValues": render.get("compose_values", {}),
            "files": render.get("files", []),
            "secretRefs": secret_refs,
        },
    }


def main() -> int:
    args = parse_args()
    try:
        manifest, inputs_schema, render, source = load_template(args.template)
        values = build_input_values(inputs_schema, args.values)
        payload = build_payload(args.template, manifest, inputs_schema, render, source, values)
    except (OSError, json.JSONDecodeError, RenderError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
