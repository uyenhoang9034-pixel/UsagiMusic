#!/bin/sh
set -eu
cd /app
exec node --max-old-space-size=128 src/app.js
