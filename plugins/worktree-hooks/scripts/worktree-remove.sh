#!/usr/bin/env bash
# WorktreeRemove hook: removes a worktree made by worktree-create.sh and its branch.
# Contract: stdin is JSON with "worktree_path".
set -uo pipefail
. "$(dirname "$0")/log.sh"

INPUT=$(cat)
hook_log_context WorktreeRemove "$INPUT"

DIR=$(printf '%s' "$INPUT" | sed -n 's/.*"worktree_path"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p' | head -n 1 | sed 's|\\\\|/|g')
[ -n "$DIR" ] || { hook_log WorktreeRemove "failed: no worktree_path in hook input"; echo "worktree-remove: no worktree_path in hook input" >&2; exit 1; }

COMMON=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --path-format=absolute --git-common-dir)
REPO=$(dirname "$COMMON")

BRANCH=$(git -C "$DIR" symbolic-ref --short HEAD 2>/dev/null || true)
git -C "$REPO" worktree remove --force "$DIR" >&2 || rm -rf "$DIR"
case "$BRANCH" in worktree-*) git -C "$REPO" branch -D "$BRANCH" >&2 || true ;; esac
hook_log WorktreeRemove "removed $DIR (branch ${BRANCH:-none})"
exit 0
