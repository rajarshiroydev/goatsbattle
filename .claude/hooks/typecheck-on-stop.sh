#!/usr/bin/env bash
# Stop hook: typecheck the project on stop.
#
# Behaviour:
#   - Allow the stop SILENTLY when `tsc --noEmit` is clean (exit 0, no output).
#   - BLOCK the stop (exit 2) only when there are real type errors, printing them
#     to stderr so Claude is asked to fix them before finishing.
#   - Never loop: Claude Code sets `stop_hook_active: true` in the hook payload
#     when it re-runs this hook because a previous run continued the agent. We
#     detect that and exit 0 immediately, breaking the re-entrancy loop.
set -uo pipefail

input=$(cat)

# Break the Stop-hook re-entrancy loop.
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

if output=$(npx tsc --noEmit 2>&1); then
  # Clean — allow the stop with no feedback.
  exit 0
fi

# Type errors — block the stop and surface them.
echo "TypeScript errors must be fixed before finishing:" >&2
printf '%s\n' "$output" >&2
exit 2
