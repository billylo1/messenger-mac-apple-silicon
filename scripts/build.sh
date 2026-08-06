#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Bake Aptabase settings into the app package (values stay out of git via .env).
# Always write aptabase.config.json so electron-builder extraResources can copy it.
if [[ -n "${APTABASE_APP_KEY:-}" && -n "${APTABASE_HOST:-}" ]]; then
  host="$APTABASE_HOST"
  if [[ "$host" != http://* && "$host" != https://* ]]; then
    host="https://$host"
  fi
  printf '{"appKey":"%s","host":"%s"}\n' "$APTABASE_APP_KEY" "$host" > aptabase.config.json
else
  echo "warning: APTABASE_APP_KEY / APTABASE_HOST not set — analytics will be disabled in this build" >&2
  printf '{}\n' > aptabase.config.json
fi

# After a successful build, attach dist/latest-mac.yml to the GitHub release
# alongside the DMG and zip so in-app self-update can resolve the feed.
exec npx electron-builder --mac "$@"

