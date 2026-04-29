#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/maybee/Documents/Codex/2026-04-20-json-v1-json-investment-controller-json"
NODE_BIN="/usr/local/bin/node"
LOG_DIR="$ROOT_DIR/.run"

mkdir -p "$LOG_DIR"
cd "$ROOT_DIR"

exec "$NODE_BIN" server.js >>"$LOG_DIR/server.stdout.log" 2>>"$LOG_DIR/server.stderr.log"
