#!/bin/sh
set -e

echo "==> Initializing AppOS..."

# Create data directories if they don't exist
mkdir -p /appos/data/redis
mkdir -p /appos/data/pb_data
mkdir -p /appos/data/apps

# Ensure proper permissions
chmod 755 /appos/data
chmod 755 /appos/data/redis
chmod 755 /appos/data/pb_data
chmod 755 /appos/data/apps

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
      --dir /appos/data/pb_data 2>&1 && \
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
