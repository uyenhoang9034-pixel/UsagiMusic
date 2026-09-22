#!/bin/sh
set -eu
echo "[UsagiMusic] Starting private Lavalink..."
cd /app/lavalink
# Keep the always-on Lavalink JVM lean. 64m is enough for idle/startup while
# 256m leaves room for normal multi-bot playback without reserving a 512m heap.
# These values only bound Java heap; playback logic/sources are unchanged.
java -Xms64m -Xmx256m -XX:+UseG1GC -jar Lavalink.jar --spring.config.location=file:/app/lavalink/application.yml &
LAVALINK_PID=$!
cleanup() { kill "$LAVALINK_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
echo "[UsagiMusic] Waiting for Lavalink..."
i=0
until curl -fsS -H "Authorization: usagi-private-lavalink" http://127.0.0.1:2333/version >/dev/null 2>&1; do
 i=$((i + 1)); if [ "$i" -ge 60 ]; then echo "[UsagiMusic] Lavalink did not become ready in time."; exit 1; fi; sleep 1
done
echo "[UsagiMusic] Lavalink ready; starting Discord workers."
cd /app
exec node src/app.js
