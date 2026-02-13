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
echo "==> Starting services via supervisord..."

# Execute CMD (supervisord)
exec "$@"
