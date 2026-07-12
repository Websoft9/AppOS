#!/bin/sh
set -e

DATA_DIR=${DATA_DIR:-/appos/data}
APPOS_CONFIG_DIR=$DATA_DIR/config
APPOS_CONFIG_FILE=$APPOS_CONFIG_DIR/appos.yaml
APPOS_WEB_DIR=${APPOS_WEB_DIR:-/appos/web}
OPENCODE_PROMPTS_DIR=$DATA_DIR/opencode/prompts
OPENCODE_AGENTS_FILE=$DATA_DIR/opencode/AGENTS.md

export DATA_DIR

yaml_quote() {
  printf "%s" "$1" | sed "s/'/''/g"
}

echo "==> Initializing AppOS..."

# Create data directories if they don't exist
mkdir -p \
    "$DATA_DIR/pb/pb_data" \
    "$DATA_DIR/pb/pb_migrations" \
    "$DATA_DIR/config" \
    "$DATA_DIR/redis" \
    "$DATA_DIR/apps" \
  "$DATA_DIR/traefik" \
    "$DATA_DIR/victoriametrics" \
    "$DATA_DIR/opencode" \
    "$DATA_DIR/opencode/prompts" \
    "$DATA_DIR/workflows" \
    "$DATA_DIR/templates/apps" \
    "$DATA_DIR/templates/workflows" \
    "$DATA_DIR/templates/custom" \
    "$DATA_DIR/templates/custom/apps" \
    "$DATA_DIR/templates/official/apps"

# Ensure proper permissions
chmod -R 755 "$DATA_DIR"

# Create directories
mkdir -p /etc/traefik/dynamic
mkdir -p "$APPOS_WEB_DIR"

cat > "$OPENCODE_AGENTS_FILE" <<'EOF'
# AGENTS.md — AppOS AI Agent Context

You are running inside AppOS.

## Working Context

- AppOS is the control plane.
- Use the local filesystem for project context and shared skills.
- Use AppOS-managed servers through explicit SSH commands when you need remote inspection or changes.

## Shared Assets

- Shared skills live under `.agents/skills/`.
- OpenCode command shortcuts live under `.opencode/commands/`.
- Exported AppOS prompts live under `/appos/data/opencode/prompts/`.

## Guardrails

- Treat AppOS as a multi-server control plane.
- Prefer read-first investigation before making changes.
- Explain risky production changes before executing them.
- Keep edits minimal and verifiable.

## Validation

- For AppOS code changes, prefer `make build` and `make test`.
- For runtime validation, use the AppOS UI or authenticated HTTP requests when helpful.
EOF

if [ -d /appos/data/prompts ]; then
	find /appos/data/prompts -type f -name '*.md' -exec cp {} "$OPENCODE_PROMPTS_DIR" \; 2>/dev/null || true
fi

echo "==> Data directories ready"

REDIS_URL=${REDIS_URL:-redis://127.0.0.1:6379}
TSDB_URL=${TSDB_URL:-http://127.0.0.1:8428}
TUNNEL_SSH_PORT=${TUNNEL_SSH_PORT:-2222}
INIT_MODE=${INIT_MODE:-auto}
SUPERUSER_EMAIL=${SUPERUSER_EMAIL:-}
SUPERUSER_PASSWORD=${SUPERUSER_PASSWORD:-}

cat > "$APPOS_CONFIG_FILE" <<EOF
data_dir: '$(yaml_quote "$DATA_DIR")'
http: '0.0.0.0:9000'
web_dir: '$(yaml_quote "$APPOS_WEB_DIR")'
redis_url: '$(yaml_quote "$REDIS_URL")'
tsdb_url: '$(yaml_quote "$TSDB_URL")'
tunnel_ssh_port: '$(yaml_quote "$TUNNEL_SSH_PORT")'
init_mode: '$(yaml_quote "$INIT_MODE")'
superuser_email: '$(yaml_quote "$SUPERUSER_EMAIL")'
superuser_password: '$(yaml_quote "$SUPERUSER_PASSWORD")'
EOF

chmod 600 "$APPOS_CONFIG_FILE"
echo "==> Runtime config written to $APPOS_CONFIG_FILE"

echo "==> Starting services via runit..."

# Execute CMD (runsvdir)
exec "$@"
