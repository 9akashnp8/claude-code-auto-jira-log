#!/usr/bin/env bash
# WorktreeRemove: logs the call like every other event, then removes the worktree and its
# worktree-* branch, since registering this hook replaces Claude Code's own removal and
# Claude Code never deletes the branch of a worktree a hook created.
set -uo pipefail
HERE=$(dirname "$0")
LOG=${HOOK_LOGGER_LOG:-$HOME/.claude/logs/hook-events.log}
note() { printf '    result=%s\n' "$*" >>"$LOG" 2>/dev/null; }

INPUT=$(cat)
printf '%s' "$INPUT" | bash "$HERE/log-event.sh" "$@"

DIR=$(printf '%s' "$INPUT" | sed -n 's/.*"worktree_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 | sed 's|\\\\|/|g')
[ -n "$DIR" ] || { note "failed: no worktree_path in input"; echo "hook-logger: no worktree_path in WorktreeRemove input" >&2; exit 1; }

REPO=$(dirname "$(git -C "$DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)")
BRANCH=$(git -C "$DIR" symbolic-ref --short HEAD 2>/dev/null || true)
git -C "$REPO" worktree remove --force "$DIR" >&2 || rm -rf "$DIR"
case "$BRANCH" in worktree-*) git -C "$REPO" branch -D "$BRANCH" >&2 || true ;; esac
if [ -d "$DIR" ]; then note "failed: $DIR still exists"; exit 1; fi
note "removed $DIR (branch ${BRANCH:-none})"
exit 0
