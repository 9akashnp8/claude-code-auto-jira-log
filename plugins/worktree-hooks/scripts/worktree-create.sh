#!/usr/bin/env bash
# WorktreeCreate hook: replaces Claude Code's default worktree creation so the
# worktree branches from a freshly fetched origin/<default branch>.
# Contract: stdin is JSON with a "name" slug; the last stdout line is the worktree path.
set -euo pipefail

NAME=$(sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
[ -n "$NAME" ] || { echo "worktree-create: no name in hook input" >&2; exit 1; }

# The main checkout, even when the session itself runs inside a worktree.
COMMON=$(git -C "$CLAUDE_PROJECT_DIR" rev-parse --path-format=absolute --git-common-dir)
REPO=$(dirname "$COMMON")

# Default branch from origin/HEAD, falling back to main.
BASE=$(git -C "$REPO" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||' || true)
BASE=${BASE:-main}

DIR="$REPO/.claude/worktrees/$NAME"
if [ ! -d "$DIR" ]; then
  # An offline fetch falls back to the cached origin/$BASE rather than failing creation.
  git -C "$REPO" fetch --quiet origin "$BASE" >&2 || echo "worktree-create: fetch failed, using cached origin/$BASE" >&2
  git -C "$REPO" worktree add --quiet -b "worktree-$NAME" "$DIR" "origin/$BASE" >&2
fi

# Print a path Claude Code understands (C:/... on Windows).
git -C "$DIR" rev-parse --show-toplevel
