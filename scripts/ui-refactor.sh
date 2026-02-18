#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 \"<ui-refactor prompt>\"" >&2
  exit 1
fi

if command -v codex >/dev/null 2>&1; then
  CODEX_CMD=(codex)
elif [[ -x "/Applications/Codex.app/Contents/Resources/codex" ]]; then
  CODEX_CMD=("/Applications/Codex.app/Contents/Resources/codex")
elif [[ -x "./node_modules/.bin/codex" ]]; then
  CODEX_CMD=("./node_modules/.bin/codex")
elif command -v npx >/dev/null 2>&1; then
  CODEX_CMD=(npx --yes @openai/codex)
else
  echo "Codex CLI not found. Install Codex or add it to PATH." >&2
  exit 1
fi

INSTRUCTIONS_FILE=".ai/CODEX_UI_MODE.md"
if [[ ! -f "$INSTRUCTIONS_FILE" ]]; then
  echo "Missing instructions file: $INSTRUCTIONS_FILE" >&2
  exit 1
fi

PROMPT="$(cat "$INSTRUCTIONS_FILE")

Task:
$*"

"${CODEX_CMD[@]}" exec "$PROMPT"
