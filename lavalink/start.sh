#!/bin/sh
set -eu
export LAVALINK_SERVER_PASSWORD="${LAVALINK_PASSWORD:-youshallnotpass}"
echo "[UsagiMusic] Starting private Lavalink..."
cd /app/lavalink
java -Xms128m -Xmx512m -jar Lavalink.jar --spring.config.location=file:/app/lavalink/application.yml &
LAVALINK_PID=$!
cleanup() { kill "$LAVALINK_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
echo "[UsagiMusic] Waiting for Lavalink..."
i=0
until curl -fsS -H "Authorization: ${LAVALINK_SERVER_PASSWORD}" http://127.0.0.1:2333/version >/dev/null 2>&1; do
 i=$((i + 1)); if [ "$i" -ge 60 ]; then echo "[UsagiMusic] Lavalink did not become ready in time."; exit 1; fi; sleep 1
done
echo "[UsagiMusic] Lavalink ready; starting Discord workers."
cd /app
exec node src/app.js
