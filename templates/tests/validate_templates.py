#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_APPS_DIR = ROOT / "templates" / "apps"
TEMPLATES_TESTS_DIR = ROOT / "templates" / "tests"
ALLOWED_STORAGE_MODES = {"system_managed", "operator_editable", "secret_backed"}
ALLOWED_VISIBILITY = {"system", "basic", "advanced"}
RENDER_PLACEHOLDER_PATTERN = re.compile(r"\$\{([^}]+)\}")


class ValidationError(Exception):
    pass


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise ValidationError(f"invalid JSON in {path}: {exc}") from exc


def require_keys(obj: dict, keys: list[str], path: str) -> None:
    missing = [key for key in keys if key not in obj]
    if missing:
        raise ValidationError(f"{path} missing required keys: {', '.join(missing)}")


def validate_manifest(manifest: dict, template_key: str) -> None:
    require_keys(
        manifest,
        ["contractVersion", "key", "name", "trademark", "capabilities", "requirements", "versions"],
        "manifest.json",
    )
    if manifest["key"] != template_key:
        raise ValidationError(
            f"manifest.json key mismatch: expected {template_key}, got {manifest['key']}"
        )


def validate_inputs(inputs_schema: dict) -> None:
    require_keys(inputs_schema, ["contractVersion", "fields"], "inputs.schema.json")
    fields = inputs_schema["fields"]
    if not isinstance(fields, list):
        raise ValidationError("inputs.schema.json fields must be an array")
    seen = set()
    for index, field in enumerate(fields):
        if not isinstance(field, dict):
            raise ValidationError(f"inputs.schema.json field[{index}] must be an object")
        require_keys(
            field,
            ["key", "type", "label", "required", "visibility", "storage_mode"],
            f"inputs.schema.json field[{index}]",
        )
        key = field["key"]
        if key in seen:
            raise ValidationError(f"duplicate input field key: {key}")
        seen.add(key)
        if field["storage_mode"] not in ALLOWED_STORAGE_MODES:
            raise ValidationError(
                f"input field {key} has unsupported storage_mode: {field['storage_mode']}"
            )
        if field["visibility"] not in ALLOWED_VISIBILITY:
            raise ValidationError(
                f"input field {key} has unsupported visibility: {field['visibility']}"
            )


def validate_render(render: dict) -> None:
    require_keys(render, ["contractVersion"], "render.json")
    if not any(key in render for key in ("env", "compose_values", "files", "exposures")):
        raise ValidationError(
            "render.json must contain at least one of: env, compose_values, files, exposures"
        )
    for env_key, env_value in render.get("env", {}).items():
        if not isinstance(env_value, str):
            raise ValidationError(f"render.json env value for {env_key} must be a string")
        for match in RENDER_PLACEHOLDER_PATTERN.findall(env_value):
            if not match:
                raise ValidationError(f"render.json env value for {env_key} contains empty placeholder")
    exposures = render.get("exposures", [])
    if exposures is not None:
        if not isinstance(exposures, list):
            raise ValidationError("render.json exposures must be an array")
        allowed_exposure_keys = {"label", "service", "port", "protocol", "default"}
        seen_exposures = set()
        default_count = 0
        for index, exposure in enumerate(exposures):
            if not isinstance(exposure, dict):
                raise ValidationError(f"render.json exposures[{index}] must be an object")
            require_keys(exposure, ["label", "service", "port", "protocol"], f"render.json exposures[{index}]")
            unknown_keys = sorted(set(exposure) - allowed_exposure_keys)
            if unknown_keys:
                raise ValidationError(
                    f"render.json exposures[{index}] has unsupported keys: {', '.join(unknown_keys)}"
                )
            marker = (exposure["service"], exposure["protocol"], exposure["port"])
            if marker in seen_exposures:
                raise ValidationError(
                    "duplicate exposure intent for service/protocol/port: "
                    f"{exposure['service']}/{exposure['protocol']}/{exposure['port']}"
                )
            seen_exposures.add(marker)
            if exposure.get("default") is True:
                default_count += 1
        if default_count > 1:
            raise ValidationError("render.json exposures may mark at most one default endpoint")


def validate_source(source: dict) -> None:
    require_keys(
        source,
        ["contractVersion", "origin_kind", "origin_ref", "template_revision", "adapter_version"],
        "source.json",
    )


def validate_required_files(template_dir: Path, required_files: list[str]) -> None:
    for rel_path in required_files:
        if not (template_dir / rel_path).exists():
            raise ValidationError(f"missing required file: {rel_path}")


def validate_expected_shape(template_key: str, template_dir: Path, manifest: dict, inputs_schema: dict, render: dict, source: dict) -> None:
    expected_path = TEMPLATES_TESTS_DIR / f"{template_key}.expected.json"
    if not expected_path.exists():
        return
    expected = load_json(expected_path)
    validate_required_files(template_dir, expected.get("requiredFiles", []))

    expected_manifest = expected.get("manifest", {})
    for key, value in expected_manifest.items():
        if manifest.get(key) != value:
            raise ValidationError(f"manifest mismatch for {key}: expected {value!r}, got {manifest.get(key)!r}")

    fields = inputs_schema.get("fields", [])
    field_keys = [field["key"] for field in fields]
    expected_inputs = expected.get("inputs", {})
    if field_keys != expected_inputs.get("fieldKeys", field_keys):
        raise ValidationError(
            f"input field key order mismatch: expected {expected_inputs.get('fieldKeys')!r}, got {field_keys!r}"
        )

    secret_backed = [field["key"] for field in fields if field["storage_mode"] == "secret_backed"]
    if secret_backed != expected_inputs.get("secretBacked", secret_backed):
        raise ValidationError(
            f"secret-backed inputs mismatch: expected {expected_inputs.get('secretBacked')!r}, got {secret_backed!r}"
        )

    system_managed = [field["key"] for field in fields if field["storage_mode"] == "system_managed"]
    if system_managed != expected_inputs.get("systemManaged", system_managed):
        raise ValidationError(
            f"system-managed inputs mismatch: expected {expected_inputs.get('systemManaged')!r}, got {system_managed!r}"
        )

    expected_render = expected.get("render", {})
    if render.get("exposures", []) != expected_render.get("exposures", []):
        raise ValidationError(
            f"render exposures mismatch: expected {expected_render.get('exposures')!r}, got {render.get('exposures', [])!r}"
        )
    if render.get("compose_values", {}).get("primaryService") != expected_render.get("primaryService"):
        raise ValidationError(
            f"render primary service mismatch: expected {expected_render.get('primaryService')!r}, got {render.get('compose_values', {}).get('primaryService')!r}"
        )
    if render.get("compose_values", {}).get("databaseService") != expected_render.get("databaseService"):
        raise ValidationError(
            f"render database service mismatch: expected {expected_render.get('databaseService')!r}, got {render.get('compose_values', {}).get('databaseService')!r}"
        )

    referenced_secrets = []
    for value in render.get("env", {}).values():
        referenced_secrets.extend(match[7:] for match in RENDER_PLACEHOLDER_PATTERN.findall(value) if match.startswith("secret:"))
    referenced_secrets = sorted(set(referenced_secrets))
    if referenced_secrets != sorted(expected_render.get("secretRefs", referenced_secrets)):
        raise ValidationError(
            f"render secret references mismatch: expected {expected_render.get('secretRefs')!r}, got {referenced_secrets!r}"
        )

    expected_source = expected.get("source", {})
    source_mapping = {
        "originKind": source.get("origin_kind"),
        "templateRevision": source.get("template_revision"),
        "adapterVersion": source.get("adapter_version"),
    }
    for key, value in expected_source.items():
        if source_mapping.get(key) != value:
            raise ValidationError(
                f"source mismatch for {key}: expected {value!r}, got {source_mapping.get(key)!r}"
            )

    adapter_path = ROOT / "templates" / "adapters" / f"{template_key}.json"
    if adapter_path.exists() and "adapter" in expected:
        adapter = load_json(adapter_path)
        expected_adapter = expected["adapter"]
        if adapter.get("currentDecisions", {}).get("primaryService") != expected_adapter.get("primaryService"):
            raise ValidationError(
                "adapter primary service mismatch: "
                f"expected {expected_adapter.get('primaryService')!r}, got {adapter.get('currentDecisions', {}).get('primaryService')!r}"
            )
        if adapter.get("currentDecisions", {}).get("publishKind") != expected_adapter.get("publishKind"):
            raise ValidationError(
                "adapter publish kind mismatch: "
                f"expected {expected_adapter.get('publishKind')!r}, got {adapter.get('currentDecisions', {}).get('publishKind')!r}"
            )


def validate_template(template_key: str) -> None:
    template_dir = TEMPLATES_APPS_DIR / template_key
    if not template_dir.exists():
        raise ValidationError(f"template not found: {template_key}")

    manifest = load_json(template_dir / "manifest.json")
    inputs_schema = load_json(template_dir / "inputs.schema.json")
    render = load_json(template_dir / "render.json")
    source = load_json(template_dir / "source.json")

    validate_manifest(manifest, template_key)
    validate_inputs(inputs_schema)
    validate_render(render)
    validate_source(source)
    validate_expected_shape(template_key, template_dir, manifest, inputs_schema, render, source)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate AppOS template contract samples")
    parser.add_argument("template", nargs="?", help="Specific template key to validate")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    template_keys = [args.template] if args.template else sorted(
        path.name for path in TEMPLATES_APPS_DIR.iterdir() if path.is_dir()
    )

    failures = []
    for template_key in template_keys:
        try:
            validate_template(template_key)
            print(f"OK  {template_key}")
        except ValidationError as exc:
            failures.append((template_key, str(exc)))
            print(f"FAIL {template_key}: {exc}", file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
