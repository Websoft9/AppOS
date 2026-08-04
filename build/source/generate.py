#!/usr/bin/env python3

from __future__ import annotations

from pathlib import Path
import tomllib

import yaml


ROOT = Path(__file__).resolve().parent.parent.parent
BUILD_DIR = ROOT / "build"
SOURCE_DIR = ROOT / "build" / "source"
SPEC_PATH = SOURCE_DIR / "spec.yaml"
VERSIONS_PATH = SOURCE_DIR / ".versions"
DOCKERFILE_OUT = BUILD_DIR / "Dockerfile.dev"
COMPOSE_OUT = BUILD_DIR / "docker-compose.dev.yml"


def load_versions() -> dict:
    with VERSIONS_PATH.open("rb") as f:
        return tomllib.load(f)


def load_spec() -> dict:
    with SPEC_PATH.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def resolve_version(ref: str, versions: dict) -> str:
    section, key = ref.split(".", 1)
    return versions[section][key]


def image_ref(item: dict, versions: dict) -> str:
    return f"{item['source_image']}:{resolve_version(item['version_ref'], versions)}"


def version_suffix(ref: str, versions: dict) -> str:
    value = resolve_version(ref, versions)
    return "" if value == "latest" else f"@{value}"


def render_dockerfile(spec: dict, versions: dict) -> str:
    lines: list[str] = []
    base = spec["base_image"]

    lines.append(
        f"ARG {base['arg_name']}={resolve_version(base['version_ref'], versions)}"
    )
    for item in spec.get("copy_from_images", []):
        lines.append(f"ARG {item['arg_name']}={image_ref(item, versions)}")

    lines.append("")
    lines.append(f"FROM ${{{base['arg_name']}}}")
    lines.append("")

    for item in spec.get("copy_from_images", []):
        alias = item["arg_name"].lower()
        lines.append(f"FROM ${{{item['arg_name']}}} AS {alias}")
        lines.append("")

    lines.append(f"FROM ${{{base['arg_name']}}}")
    lines.append("")

    lines.extend(
        [
            "ARG APT_MIRROR",
            "ARG APT_SECURITY_MIRROR",
            "ARG NPM_REGISTRY=https://registry.npmjs.org/",
            "ARG GOPROXY=https://proxy.golang.org,direct",
            "ARG GOSUMDB=sum.golang.org",
            "ARG PIP_INDEX_URL=https://pypi.org/simple",
            "",
            "ENV GOPROXY=${GOPROXY} \\",
            "  GOSUMDB=${GOSUMDB} \\",
            "  PIP_INDEX_URL=${PIP_INDEX_URL}",
            "",
        ]
    )

    apt_packages = spec.get("apt_packages", [])
    if apt_packages:
        lines.extend(
            [
                "RUN set -eux; \\",
                '  if [ -n "${APT_MIRROR}" ]; then \\',
                "    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \\",
                '      sed -ri "s|https?://deb.debian.org/debian|${APT_MIRROR}|g; s|https?://security.debian.org/debian-security|${APT_SECURITY_MIRROR:-${APT_MIRROR}}|g" /etc/apt/sources.list.d/debian.sources; \\',
                "    fi; \\",
                "    if [ -f /etc/apt/sources.list ]; then \\",
                '      sed -ri "s|https?://deb.debian.org/debian|${APT_MIRROR}|g; s|https?://security.debian.org/debian-security|${APT_SECURITY_MIRROR:-${APT_MIRROR}}|g" /etc/apt/sources.list; \\',
                "    fi; \\",
                "  fi; \\",
                "  apt-get update && apt-get install -y --no-install-recommends \\",
            ]
        )
        for index, pkg in enumerate(apt_packages):
            suffix = (
                " \\\\"
                if index < len(apt_packages) - 1
                else " && rm -rf /var/lib/apt/lists/*"
            )
            lines.append(f"  {pkg}{suffix}")
        lines.append("")

    for item in spec.get("copy_from_images", []):
        alias = item["arg_name"].lower()
        copy = item["copy"]
        if isinstance(copy, list):
            for pair in copy:
                lines.append(
                    f"COPY --from={alias} {pair['from_path']} {pair['to_path']}"
                )
        else:
            lines.append(f"COPY --from={alias} {copy['from_path']} {copy['to_path']}")
    if spec.get("copy_from_images"):
        lines.append("")

    for item in spec.get("go_install", []):
        lines.append(
            f"RUN GOBIN=/usr/local/bin go install {item['package']}{version_suffix(item['version_ref'], versions)}"
        )
        lines.append("")

    npm_global = spec.get("npm_global", [])
    if npm_global:
        packages = [
            f"{item['package']}{version_suffix(item['version_ref'], versions)}"
            for item in npm_global
        ]
        lines.append(
            f'RUN npm config set -g registry "${{NPM_REGISTRY}}" && npm install -g {" ".join(packages)}'
        )
        for item in npm_global:
            if item.get("post_install"):
                lines.append(f"RUN {item['post_install']}")
        lines.append("")

    lines.extend(
        [
            "ENV DISABLE_TELEMETRY=1 \\",
            "  DO_NOT_TRACK=1",
            "",
            f"WORKDIR {spec['workspace']['folder']}",
            "",
            'CMD ["sleep", "infinity"]',
            "",
        ]
    )
    return "\n".join(lines)


def render_compose(spec: dict) -> str:
    build_args = {
        spec["base_image"]["arg_name"]: "${DEVCONTAINER_BASE_IMAGE:-}",
    }
    for item in spec.get("copy_from_images", []):
        build_args[item["arg_name"]] = f"${{{item['arg_name']}:-}}"
    build_args.update(
        {
            "APT_MIRROR": "${DEVCONTAINER_APT_MIRROR:-}",
            "APT_SECURITY_MIRROR": "${DEVCONTAINER_APT_SECURITY_MIRROR:-}",
            "NPM_REGISTRY": "${DEVCONTAINER_NPM_REGISTRY:-}",
            "GOPROXY": "${DEVCONTAINER_GOPROXY:-}",
            "GOSUMDB": "${DEVCONTAINER_GOSUMDB:-}",
            "PIP_INDEX_URL": "${DEVCONTAINER_PIP_INDEX_URL:-}",
        }
    )

    workspace = spec["workspace"]
    volumes = [f"..:{workspace['folder']}"]
    for mount in spec.get("mounts", []):
        volumes.append(f"{mount['source']}:{mount['target']}")

    compose = {
        "services": {
            spec["metadata"]["container_name"]: {
                "build": {
                    "context": "..",
                    "dockerfile": "build/Dockerfile.dev",
                    "args": build_args,
                },
                "container_name": spec["metadata"]["container_name"],
                "working_dir": workspace["folder"],
                "command": ["sleep", "infinity"],
                "tty": True,
                "stdin_open": True,
                "volumes": volumes,
                "environment": spec.get("environment", {}),
            }
        },
        "volumes": {
            mount["source"]: None
            for mount in spec.get("mounts", [])
            if mount["type"] == "volume"
        },
    }
    return yaml.safe_dump(compose, sort_keys=False)


def main() -> None:
    versions = load_versions()
    spec = load_spec()
    DOCKERFILE_OUT.write_text(render_dockerfile(spec, versions), encoding="utf-8")
    COMPOSE_OUT.write_text(render_compose(spec), encoding="utf-8")
    print(f"Generated {DOCKERFILE_OUT}")
    print(f"Generated {COMPOSE_OUT}")


if __name__ == "__main__":
    main()
