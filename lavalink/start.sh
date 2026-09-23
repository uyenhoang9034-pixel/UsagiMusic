#!/bin/sh
set -eu
echo "[UsagiMusic] Starting private lean Lavalink..."
cd /app/lavalink

# Low-memory JVM tuning:
# - SerialGC replaces G1GC (saves 50-80MB of GC thread/region overhead)
# - Xms32m / Xmx128m limits Java heap
# - Xss256k cuts thread stack size from default 1024k (saves ~30MB with 40 threads)
# - CICompilerCount=2 cuts JIT compiler memory
# - MinHeapFreeRatio/MaxHeapFreeRatio ensures heap is reclaimed proactively
java -XX:+UseSerialGC \
     -Xss256k \
     -Xms32m \
     -Xmx128m \
     -XX:CICompilerCount=2 \
     -XX:MinHeapFreeRatio=5 \
     -XX:MaxHeapFreeRatio=10 \
     -jar Lavalink.jar \
     --spring.config.location=file:/app/lavalink/application.yml &
LAVALINK_PID=$!
cleanup() { kill "$LAVALINK_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "[UsagiMusic] Waiting for Lavalink..."
i=0
until curl -fsS -H "Authorization: usagi-private-lavalink" http://127.0.0.1:2333/version >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then
    echo "[UsagiMusic] Lavalink did not become ready in time."
    exit 1
  fi
  sleep 1
done

echo "[UsagiMusic] Lavalink ready; starting Discord single-process controller."
cd /app
exec node --max-old-space-size=96 src/app.js
