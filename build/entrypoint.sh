#!/bin/sh
set -e

DATA_DIR=${DATA_DIR:-/appos/data}
SECRET_KEY_FILE=$DATA_DIR/.appos_secret_key
APPOS_CONFIG_DIR=$DATA_DIR/config
APPOS_CONFIG_FILE=$APPOS_CONFIG_DIR/appos.yaml

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
    "$DATA_DIR/victoriametrics" \
    "$DATA_DIR/workflows" \
    "$DATA_DIR/templates/apps" \
    "$DATA_DIR/templates/workflows" \
    "$DATA_DIR/templates/custom" \
    "$DATA_DIR/templates/custom/apps" \
    "$DATA_DIR/templates/official/apps"

if [ -f "$SECRET_KEY_FILE" ]; then
  persisted_secret_key=$(tr -d '\n\r' < "$SECRET_KEY_FILE")
  if [ -n "$APPOS_SECRET_KEY" ] && [ "$APPOS_SECRET_KEY" != "$persisted_secret_key" ]; then
    echo "==> [WARN] Ignoring provided APPOS_SECRET_KEY because a persisted key already exists"
  fi
  APPOS_SECRET_KEY=$persisted_secret_key
elif [ -n "$APPOS_SECRET_KEY" ]; then
  printf '%s' "$APPOS_SECRET_KEY" > "$SECRET_KEY_FILE"
  chmod 600 "$SECRET_KEY_FILE"
else
  APPOS_SECRET_KEY=$(openssl rand -base64 32 | tr -d '\n')
  printf '%s' "$APPOS_SECRET_KEY" > "$SECRET_KEY_FILE"
  chmod 600 "$SECRET_KEY_FILE"
  echo "==> Generated and persisted APPOS_SECRET_KEY"
fi

export APPOS_SECRET_KEY

# Ensure proper permissions
chmod -R 755 "$DATA_DIR"
chmod 600 "$SECRET_KEY_FILE"

# Create log directories
mkdir -p /var/log/supervisor
mkdir -p /var/log/nginx
mkdir -p /run/nginx

echo "==> Data directories ready"

REDIS_URL=${REDIS_URL:-redis://127.0.0.1:6379}
TSDB_URL=${TSDB_URL:-http://127.0.0.1:8428}
TUNNEL_SSH_PORT=${TUNNEL_SSH_PORT:-2222}
INIT_MODE=${INIT_MODE:-auto}
SUPERUSER_EMAIL=${SUPERUSER_EMAIL:-}
SUPERUSER_PASSWORD=${SUPERUSER_PASSWORD:-}

cat > "$APPOS_CONFIG_FILE" <<EOF
data_dir: '$(yaml_quote "$DATA_DIR")'
http: '127.0.0.1:8090'
redis_url: '$(yaml_quote "$REDIS_URL")'
tsdb_url: '$(yaml_quote "$TSDB_URL")'
tunnel_ssh_port: '$(yaml_quote "$TUNNEL_SSH_PORT")'
init_mode: '$(yaml_quote "$INIT_MODE")'
superuser_email: '$(yaml_quote "$SUPERUSER_EMAIL")'
superuser_password: '$(yaml_quote "$SUPERUSER_PASSWORD")'
EOF

chmod 600 "$APPOS_CONFIG_FILE"
echo "==> Runtime config written to $APPOS_CONFIG_FILE"

echo "==> Starting services via supervisord..."

# Execute CMD (supervisord)
exec "$@"
