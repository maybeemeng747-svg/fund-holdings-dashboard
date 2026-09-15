#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT_DIR/scripts/com.maybee.fund-dashboard.plist"
TARGET="$HOME/Library/LaunchAgents/com.maybee.fund-dashboard.plist"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
HOLDINGS_FILE="${HOLDINGS_FILE:-$HOME/.openclaw/workspace/portfolio/holdings.json}"
TUSHARE_ENV_FILE="${TUSHARE_ENV_FILE:-$HOME/TradingAgents-AShare/.env}"
SERVICE="gui/$(id -u)/com.maybee.fund-dashboard"

escape_sed() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

mkdir -p "$ROOT_DIR/.run" "$(dirname "$TARGET")"

PROJECT_VALUE="$(escape_sed "$ROOT_DIR")"
NODE_VALUE="$(escape_sed "$NODE_BIN")"
HOLDINGS_VALUE="$(escape_sed "$HOLDINGS_FILE")"
TUSHARE_ENV_VALUE="$(escape_sed "$TUSHARE_ENV_FILE")"

sed \
  -e "s|__PROJECT_DIR__|$PROJECT_VALUE|g" \
  -e "s|__NODE_BIN__|$NODE_VALUE|g" \
  -e "s|__HOLDINGS_FILE__|$HOLDINGS_VALUE|g" \
  -e "s|__TUSHARE_ENV_FILE__|$TUSHARE_ENV_VALUE|g" \
  "$TEMPLATE" >"$TARGET"

plutil -lint "$TARGET"
launchctl bootout "$SERVICE" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"

echo "Fund dashboard LaunchAgent installed: $TARGET"
