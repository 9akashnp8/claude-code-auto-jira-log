#!/usr/bin/env bash
# SessionStart hook: when a new session starts in a fresh worktree, fetches the branch
# the worktree was made from and fast-forwards the worktree to it. This covers worktrees
# made without WorktreeCreate, such as the desktop app's Code tab, which branches from
# the selected branch as of the last fetch.
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
hook_log SessionStart "$KIND dir=$DIR source=${SOURCE:-unknown} branch=$BRANCH head=$HEAD_SHA"

skip() { hook_log SessionStart "no sync: $*"; exit 0; }
[ "${WORKTREE_HOOKS_SYNC:-1}" != 0 ] || skip "WORKTREE_HOOKS_SYNC=0"
[ "$KIND" = linked-worktree ] || skip "not a linked worktree"
[ "$SOURCE" = startup ] || skip "source is ${SOURCE:-unknown}, not startup"
[ "$BRANCH" != detached ] || skip "detached HEAD"

# The branch the worktree was made from. The desktop app records the one picked in its
# branch selector as "sourceBranch" in its session file. That file is the app's own and
# undocumented, so when it can't be read, fall back to the one branch, other than this
# worktree's, whose tip is HEAD: a fresh worktree still sits where it was cut.
from_desktop_app() {
  local root file path want
  want=$(printf '%s' "$DIR" | tr '[:upper:]' '[:lower:]')
  for root in "${APPDATA:-}/Claude" "$HOME/Library/Application Support/Claude" "${XDG_CONFIG_HOME:-$HOME/.config}/Claude"; do
    [ -d "$root/claude-code-sessions" ] || continue
    # Find candidates by folder name, then compare the full path: some grep builds
    # never match a fixed string with backslashes in it.
    grep -rlF --include='local_*.json' "\"worktreeName\":\"$(basename "$DIR")\"" "$root/claude-code-sessions" 2>/dev/null |
      while IFS= read -r file; do
        path=$(sed -n 's/.*"worktreePath":"\([^"]*\)".*/\1/p' "$file" | sed 's|\\\\|/|g' | tr '[:upper:]' '[:lower:]')
        [ "$path" = "$want" ] || continue
        sed -n 's/.*"sourceBranch":"\([^"]*\)".*/\1/p' "$file"
        break
      done | head -n 1
    return 0
  done
}
from_branch_tips() {
  git -C "$DIR" for-each-ref --points-at HEAD --format='%(refname)' refs/heads refs/remotes/origin |
    grep -v -e "^refs/heads/$BRANCH\$" -e '^refs/remotes/origin/HEAD$' |
    sed -e 's|^refs/heads/||' -e 's|^refs/remotes/origin/||' | sort -u
}

BASE=$(from_desktop_app)
FOUND_BY="desktop app session"
if [ -z "$BASE" ]; then
  CANDIDATES=$(from_branch_tips)
  [ -n "$CANDIDATES" ] || skip "can't tell which branch this worktree came from: no other branch is at $HEAD_SHA"
  [ "$(printf '%s\n' "$CANDIDATES" | wc -l)" -eq 1 ] ||
    skip "can't tell which branch this worktree came from: $(printf '%s\n' "$CANDIDATES" | paste -sd ' ') are all at $HEAD_SHA"
  BASE=$CANDIDATES
  FOUND_BY="only other branch at HEAD"
fi
BASE=${BASE#origin/}
hook_log SessionStart "made from $BASE (found by: $FOUND_BY)"

[ -z "$(git -C "$DIR" status --porcelain --untracked-files=no)" ] || skip "uncommitted changes"
timeout 20 git -C "$DIR" fetch --quiet origin "$BASE" >&2 || skip "could not fetch $BASE from origin"
TARGET=origin/$BASE
NEW_SHA=$(git -C "$DIR" rev-parse --short "$TARGET" 2>/dev/null) || skip "no $TARGET after fetching"
[ "$NEW_SHA" != "$HEAD_SHA" ] || skip "already at $TARGET ($NEW_SHA)"
git -C "$DIR" merge-base --is-ancestor HEAD "$TARGET" || skip "$BRANCH has commits not on $TARGET"

if git -C "$DIR" merge --ff-only --quiet "$TARGET" >&2; then
  hook_log SessionStart "fast-forwarded $BRANCH $HEAD_SHA -> $NEW_SHA ($TARGET)"
  echo "worktree-hooks: fast-forwarded this worktree's branch $BRANCH from $HEAD_SHA to $NEW_SHA, the latest $TARGET it was made from."
else
  hook_log SessionStart "failed: git merge --ff-only $TARGET"
fi
exit 0
