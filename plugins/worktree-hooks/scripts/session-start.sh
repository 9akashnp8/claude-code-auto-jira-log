#!/usr/bin/env bash
# SessionStart hook: when a new session starts in a fresh worktree, fetches the default
# branch and fast-forwards the worktree to it. This covers worktrees made without
# WorktreeCreate, such as the desktop app's Code tab, which branches from whatever
# origin/<default branch> was at the last fetch.
#
# It only moves a branch with no commits of its own and no uncommitted changes, and only
# on "startup", never on resume, clear or compact. Set WORKTREE_HOOKS_SYNC=0 to only log.
# SessionStart stdout is added to Claude's context, so the one line printed says what moved.
set -uo pipefail
. "$(dirname "$0")/log.sh"

INPUT=$(cat)
hook_log_context SessionStart "$INPUT"

json_field() {
  printf '%s' "$INPUT" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

# CLAUDE_PROJECT_DIR and the hook's own directory stay on the main checkout in a
# worktree session; only the input's cwd is the worktree.
DIR=$(json_field cwd | sed 's|\\\\|/|g')
DIR=${DIR:-${CLAUDE_PROJECT_DIR:-$PWD}}
SOURCE=$(json_field source)

GIT_DIR=$(git -C "$DIR" rev-parse --path-format=absolute --git-dir 2>/dev/null) || {
  hook_log SessionStart "not a git repository: $DIR"
  exit 0
}
COMMON=$(git -C "$DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
[ "$GIT_DIR" = "$COMMON" ] && KIND=main-checkout || KIND=linked-worktree

BRANCH=$(git -C "$DIR" symbolic-ref --short HEAD 2>/dev/null || echo detached)
HEAD_SHA=$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null || echo none)
BASE=$(git -C "$DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main)
hook_log SessionStart "$KIND dir=$DIR source=${SOURCE:-unknown} branch=$BRANCH head=$HEAD_SHA cached $BASE=$(git -C "$DIR" rev-parse --short "$BASE" 2>/dev/null || echo none)"

skip() { hook_log SessionStart "no sync: $*"; exit 0; }
[ "${WORKTREE_HOOKS_SYNC:-1}" != 0 ] || skip "WORKTREE_HOOKS_SYNC=0"
[ "$KIND" = linked-worktree ] || skip "not a linked worktree"
[ "$SOURCE" = startup ] || skip "source is ${SOURCE:-unknown}, not startup"
[ "$BRANCH" != detached ] || skip "detached HEAD"
[ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ] || skip "uncommitted changes"

if ! timeout 20 git -C "$DIR" fetch --quiet origin "${BASE#origin/}" >&2; then
  skip "fetch failed"
fi
NEW_SHA=$(git -C "$DIR" rev-parse --short "$BASE")
[ "$NEW_SHA" != "$HEAD_SHA" ] || skip "already at $BASE ($NEW_SHA)"
git -C "$DIR" merge-base --is-ancestor HEAD "$BASE" || skip "$BRANCH has commits not on $BASE"

if git -C "$DIR" merge --ff-only --quiet "$BASE" >&2; then
  hook_log SessionStart "fast-forwarded $BRANCH $HEAD_SHA -> $NEW_SHA ($BASE)"
  echo "worktree-hooks: fast-forwarded this worktree's branch $BRANCH from $HEAD_SHA to $NEW_SHA, the latest $BASE."
else
  hook_log SessionStart "failed: git merge --ff-only $BASE"
fi
exit 0
