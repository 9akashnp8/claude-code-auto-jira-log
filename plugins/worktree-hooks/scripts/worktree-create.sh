#!/usr/bin/env bash
# WorktreeCreate hook: replaces Claude Code's default worktree creation so the
# worktree branches from a freshly fetched origin/<default branch>.
# Contract: stdin is JSON with a "name" slug; the last stdout line is the worktree path.
set -euo pipefail
. "$(dirname "$0")/log.sh"

INPUT=$(cat)
hook_log_context WorktreeCreate "$INPUT"
trap 'hook_log WorktreeCreate "failed: exit $? at line $LINENO: $BASH_COMMAND"' ERR

NAME=$(printf '%s' "$INPUT" | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
[ -n "$NAME" ] || { hook_log WorktreeCreate "failed: no name in hook input"; echo "worktree-create: no name in hook input" >&2; exit 1; }

# The main checkout, even when the session itself runs inside a worktree.
COMMON=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --path-format=absolute --git-common-dir)
REPO=$(dirname "$COMMON")

# Default branch from origin/HEAD, falling back to main.
BASE=$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)
BASE=${BASE:-main}

DIR="$REPO/.claude/worktrees/$NAME"
if [ ! -d "$DIR" ]; then
  # An offline fetch falls back to the cached origin/$BASE rather than failing creation.
  if git -C "$REPO" fetch --quiet origin "$BASE" >&2; then
    hook_log WorktreeCreate "fetched origin/$BASE at $(git -C "$REPO" rev-parse --short "origin/$BASE")"
  else
    hook_log WorktreeCreate "fetch failed, using cached origin/$BASE"
    echo "worktree-create: fetch failed, using cached origin/$BASE" >&2
  fi
  git -C "$REPO" worktree add --quiet -b "worktree-$NAME" "$DIR" "origin/$BASE" >&2
else
  hook_log WorktreeCreate "reusing existing $DIR"
fi

# Print a path Claude Code understands (C:/... on Windows).
OUT=$(git -C "$DIR" rev-parse --show-toplevel)
hook_log WorktreeCreate "created $OUT on worktree-$NAME"
echo "$OUT"
