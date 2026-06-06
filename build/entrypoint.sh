#!/bin/sh
set -e

SECRET_KEY_FILE=/appos/data/.appos_secret_key

echo "==> Initializing AppOS..."

# Create data directories if they don't exist
mkdir -p \
    /appos/data/pb/pb_data \
    /appos/data/pb/pb_migrations \
    /appos/data/redis \
    /appos/data/apps \
    /appos/data/victoriametrics \
    /appos/data/workflows \
    /appos/data/templates/apps \
    /appos/data/templates/workflows \
  /appos/data/templates/custom \
  /appos/data/templates/custom/apps \
  /appos/data/templates/official/apps

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
chmod -R 755 /appos/data
chmod 600 "$SECRET_KEY_FILE"

# Create log directories
mkdir -p /var/log/supervisor
mkdir -p /var/log/nginx
mkdir -p /run/nginx

echo "==> Data directories ready"

# Initialize superuser based on INIT_MODE
# - auto (default): create superuser from env vars
# - setup: skip, user creates via Setup page on first visit
INIT_MODE=${INIT_MODE:-auto}
echo "==> Init mode: $INIT_MODE"

if [ "$INIT_MODE" = "auto" ]; then
  if [ -n "$SUPERUSER_EMAIL" ] && [ -n "$SUPERUSER_PASSWORD" ]; then
    echo "==> Initializing superuser..."
    /usr/local/bin/appos superuser upsert "$SUPERUSER_EMAIL" "$SUPERUSER_PASSWORD" \
      --dir /appos/data/pb/pb_data 2>&1 && \
      echo "==> Superuser ready: $SUPERUSER_EMAIL" || \
      echo "==> [WARN] Failed to initialize superuser"
  else
    echo "==> [WARN] SUPERUSER_EMAIL or SUPERUSER_PASSWORD not set, skipping"
  fi
else
  echo "==> Setup mode: superuser will be created via web UI"
fi

echo "==> Starting services via supervisord..."

# Execute CMD (supervisord)
exec "$@"
