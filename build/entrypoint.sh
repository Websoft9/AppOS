#!/bin/sh
set -e

echo "==> Initializing AppOS..."

# Create data directories if they don't exist
mkdir -p \
    /appos/data/pb/pb_data \
    /appos/data/pb/pb_migrations \
    /appos/data/redis \
    /appos/data/apps \
    /appos/data/pi \
    /appos/data/netdata/etc \
    /appos/data/netdata/lib \
    /appos/data/netdata/cache \
    /appos/data/victoriametrics \
    /appos/data/workflows \
    /appos/data/templates/apps \
    /appos/data/templates/workflows \
    /appos/data/templates/custom

# Ensure proper permissions
chmod -R 755 /appos/data

# Create log directories
mkdir -p /var/log/supervisor
mkdir -p /var/log/netdata
mkdir -p /var/log/nginx
mkdir -p /run/nginx

if [ ! -f /appos/data/netdata/etc/netdata.conf ]; then
  cp -a /usr/local/share/appos/netdata-defaults/. /appos/data/netdata/etc/
fi

# Refresh the AppOS-managed remote write config on every startup so stale volumes
# do not keep exporting with missing hostname or chart filters.
cp /usr/local/share/appos/netdata-defaults/exporting.conf /appos/data/netdata/etc/exporting.conf

APPOS_NETDATA_JOIN_HOST_NETNS=${APPOS_NETDATA_JOIN_HOST_NETNS:-false}
if [ "$APPOS_NETDATA_JOIN_HOST_NETNS" = "true" ]; then
  APPOS_CONTAINER_IP=$(hostname -i 2>/dev/null | awk '{print $1}')
  if [ -n "$APPOS_CONTAINER_IP" ]; then
    sed -i "s/^    destination = .*/    destination = ${APPOS_CONTAINER_IP}:8428/" /appos/data/netdata/etc/exporting.conf
    echo "==> Netdata host-netns mode enabled: remote write destination set to ${APPOS_CONTAINER_IP}:8428"
  else
    echo "==> [WARN] Netdata host-netns mode requested but container bridge IP could not be determined"
  fi
fi

rm -rf /etc/netdata /var/lib/netdata /var/cache/netdata
ln -s /appos/data/netdata/etc /etc/netdata
ln -s /appos/data/netdata/lib /var/lib/netdata
ln -s /appos/data/netdata/cache /var/cache/netdata

echo "==> Data directories ready"
echo "==> Embedded Netdata configured: /appos/data/netdata/{etc,lib,cache}"

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
