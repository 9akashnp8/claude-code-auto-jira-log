#!/usr/bin/env bash
# WorktreeCreate: logs the call like every other event, then creates the worktree,
# since registering this hook replaces Claude Code's own creation.
# It makes .claude/worktrees/<name> on a new branch, worktree-<name>, from the project's
# current HEAD (Claude Code's own default is origin/<default branch>), and prints its path.
set -uo pipefail
HERE=$(dirname "$0")
LOG=${HOOK_LOGGER_LOG:-$HOME/.claude/logs/hook-events.log}
note() { printf '    result=%s\n' "$*" >>"$LOG" 2>/dev/null; }

INPUT=$(cat)
printf '%s' "$INPUT" | bash "$HERE/log-event.sh" "$@"

NAME=$(printf '%s' "$INPUT" | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
[ -n "$NAME" ] || { note "failed: no name in input"; echo "hook-logger: no name in WorktreeCreate input" >&2; exit 1; }

PROJECT=${CLAUDE_PROJECT_DIR:-$PWD}
REPO=$(dirname "$(git -C "$PROJECT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)")
DIR="$REPO/.claude/worktrees/$NAME"
if [ -d "$DIR" ]; then
  note "reusing $DIR"
elif ! git -C "$PROJECT" worktree add --quiet -b "worktree-$NAME" "$DIR" HEAD >&2; then
  note "failed: git worktree add $DIR from $(git -C "$PROJECT" rev-parse --short HEAD 2>/dev/null) in $PROJECT"
  exit 1
fi

OUT=$(git -C "$DIR" rev-parse --show-toplevel)
note "printed $OUT ($(git -C "$DIR" symbolic-ref --short HEAD 2>/dev/null) at $(git -C "$DIR" rev-parse --short HEAD))"
echo "$OUT"
