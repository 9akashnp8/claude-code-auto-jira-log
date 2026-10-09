#!/usr/bin/env bash
# SessionStart hook: logs every session start with its worktree and base, and changes
# nothing. A session in a worktree whose WorktreeCreate entry is missing from the log
# had its worktree made without the hook, as the desktop app's Code tab may do.
# SessionStart stdout is added to Claude's context, so this prints nothing.
set -uo pipefail
. "$(dirname "$0")/log.sh"

INPUT=$(cat)
hook_log_context SessionStart "$INPUT"

DIR=${CLAUDE_PROJECT_DIR:-$PWD}
GIT_DIR=$(git -C "$DIR" rev-parse --path-format=absolute --git-dir 2>/dev/null) || {
  hook_log SessionStart "not a git repository: $DIR"
  exit 0
}
COMMON=$(git -C "$DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ "$GIT_DIR" = "$COMMON" ] && KIND=main-checkout || KIND=linked-worktree

BRANCH=$(git -C "$DIR" symbolic-ref --short HEAD 2>/dev/null || echo detached)
HEAD_SHA=$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null || echo none)
BASE=$(git -C "$DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
BASE_SHA=$(git -C "$DIR" rev-parse --short "$BASE" 2>/dev/null || echo none)
if git -C "$DIR" merge-base --is-ancestor "$BASE" HEAD 2>/dev/null; then
  STATE="contains $BASE"
else
  STATE="behind or diverged from $BASE"
fi

hook_log SessionStart "$KIND branch=$BRANCH head=$HEAD_SHA $BASE=$BASE_SHA ($STATE, as of the last fetch)"
exit 0
