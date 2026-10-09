#!/usr/bin/env bash
# Logs one hook call: the event name, its arguments, a few environment values and the
# full JSON input Claude Code sent on stdin. Prints nothing and always exits 0, so it
# never changes what Claude Code does.
# The log is at ~/.claude/logs/hook-events.log unless HOOK_LOGGER_LOG says otherwise.

LOG=${HOOK_LOGGER_LOG:-$HOME/.claude/logs/hook-events.log}
mkdir -p "$(dirname "$LOG")" 2>/dev/null
INPUT=$(cat | tr -d '\r\n')
{
  printf '%s [%s] pid=%s args=[%s] entrypoint=%s project_dir=%s\n' \
    "$(date '+%Y-%m-%dT%H:%M:%S%z')" "${1:-unknown}" "$$" "$*" \
    "${CLAUDE_CODE_ENTRYPOINT:-unset}" "${CLAUDE_PROJECT_DIR:-unset}"
  printf '    input=%s\n' "$INPUT"
} >>"$LOG" 2>/dev/null
exit 0
