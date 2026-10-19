#!/bin/sh
set -eu
# Docker sets HOSTNAME to the container id. Next.js would try to bind that name.
export HOSTNAME=0.0.0.0
export PORT="${PORT:-8480}"
mkdir -p "${HEILSS_DATA_DIR:-/data}"
exec node server.js
