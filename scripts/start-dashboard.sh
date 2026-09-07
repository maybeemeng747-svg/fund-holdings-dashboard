#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
LOG_DIR="$ROOT_DIR/.run"

mkdir -p "$LOG_DIR"
cd "$ROOT_DIR"
export HOLDINGS_FILE="${HOLDINGS_FILE:-$HOME/.openclaw/workspace/portfolio/holdings.json}"

exec "$NODE_BIN" server.js >>"$LOG_DIR/server.stdout.log" 2>>"$LOG_DIR/server.stderr.log"
