#!/usr/bin/env bash
# Starts the Fluid agent and the web client. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "$0")"
(cd agent && env -u ANTHROPIC_API_KEY uv run python server.py) &
agent=$!
trap 'kill $agent 2>/dev/null' EXIT
(cd web && { [ -d node_modules ] || npm install --no-fund --no-audit; } && npx vite)
