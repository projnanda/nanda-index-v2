#!/bin/sh
set -e
echo "Running database migrations..."
node dist/db/migrate.js
echo "Starting NANDA Index server..."
exec node dist/server.js
