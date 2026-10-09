# Sourced by the hook scripts: appends one line per call to a log file, so a hook
# that runs, fails or never fires can be told apart after the fact.
# The log is at ~/.claude/logs/worktree-hooks.log unless WORKTREE_HOOKS_LOG says otherwise.

HOOK_LOG=${WORKTREE_HOOKS_LOG:-$HOME/.claude/logs/worktree-hooks.log}
mkdir -p "$(dirname "$HOOK_LOG")" 2>/dev/null || true

# hook_log <event> <message...>
hook_log() {
  local event=$1
  shift
  printf '%s [%s] pid=%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$event" "$$" "$*" >>"$HOOK_LOG" 2>/dev/null || true
}

# hook_log_context <event> <hook input JSON>: what ran the hook, and with what.
hook_log_context() {
  local event=$1 input=$2
  hook_log "$event" "input=$(printf '%s' "$input" | tr -d '\r\n')"
  hook_log "$event" "entrypoint=${CLAUDE_CODE_ENTRYPOINT:-unset} project_dir=${CLAUDE_PROJECT_DIR:-unset} plugin_root=${CLAUDE_PLUGIN_ROOT:-unset}"
  hook_log "$event" "shell=$BASH bash=$BASH_VERSION os=$(uname -s 2>/dev/null) pwd=$PWD"
}
