# claude-code-auto-jira-log

A Claude Code plugin that keeps Jira Cloud up to date with the work you do in Claude Code, a second one, [git-push](#git-push), that pushes your commits from a button, and a third, [worktree-hooks](#worktree-hooks), that starts each worktree from the latest remote branch.

- **Link** a worktree to a Jira issue: pick one of your open issues, type a key, or create a new issue drafted from the conversation.
- **Record** the day's work on that issue as you go: files edited, commits, test runs, pull requests, and Artifacts published.
- **Post** one daily comment per issue: a few plain notes on what was done, and on any problem, how it was resolved or what it waits on. Claude drafts it from that record and the conversation, and you review it before it is sent. The notes carry no sections, so a weekly report built from the comments can sort the work its own way.
- **See** at a glance whether your work is in Jira: a line above the prompt shows the linked issue, its status, and how many actions are recorded but not yet posted, today's and any earlier day's, with a button to draft the update.
- **Move** the issue along: To Do becomes In Progress when you link it, and `/jira update` suggests the next status (In Review once a pull request is up, Done once it is merged) for you to confirm with one press.

Built on Claude Code's function hooks (early access); the API can change between Claude Code releases.

## Install

```
/plugin marketplace add 9akashnp8/claude-code-auto-jira-log
/plugin install jira-log@auto-jira-log
```

## Set up

1. Create an API token at id.atlassian.com > Security > API tokens.
2. Run `/jira setup`, fill in your site URL (`https://your-team.atlassian.net`), email and token, then press **Save and test connection**. Add a project key too if you want to create issues from Claude Code.

The token is encrypted with Windows DPAPI before it is stored, so it opens only for your Windows user on that machine. Token storage needs Windows PowerShell.

## Use

| Command | What it does |
| --- | --- |
| `/jira` | Shows which issue this worktree is linked to |
| `/jira setup` | Opens the connection form |
| `/jira link [KEY]` | Links this worktree to an issue; without a key, opens the picker |
| `/jira new [what for]` | Drafts a ticket (goal, scope, acceptance criteria) from the conversation, focused on what you type after `new` if anything: pick its type, revise it, then create and link it |
| `/jira update` | Drafts today's comment in the Jira pane: revise it, post it or discard it |
| `/jira status` | Moves the linked issue to any status its workflow allows, such as Done |
| `/jira unlink` | Removes the link |

Running `/jira update` again on the same day replaces that day's comment, unless someone edited it in Jira since; then a new comment is added.

A day whose work never reached Jira is not lost: the next `/jira update`, within 14 days, drafts that work into its comment along with the day's own, and posting it marks the earlier day as covered.

Linking a To Do issue looks for a transition into a status named In Progress (any case); when the workflow has none, a toast says so and the issue stays where it is.

`/jira update` only suggests moves the issue's workflow allows from its current status, and nothing moves until you press the button. Its evidence is the conversation and the day's record, which notes pull and merge requests opened from Claude Code by `gh pr create`, `glab mr create`, `az repos pr create`, or an MCP tool such as `create_pull_request`. A pull request opened in the browser counts once you mention it in the conversation.

## git-push

A second plugin in this marketplace: push the branch and open its pull request from buttons above the prompt, then follow the pull request there until it is merged.

```
/plugin install git-push@auto-jira-log
```

### Push

When the branch has commits that are not on `origin`, the line above the prompt says so, with a **Push** button:

- `feature/export · not on origin yet · 2 commits`: the branch was never pushed. **Push** runs `git push --set-upstream origin HEAD`, so `origin/feature/export` is created and tracked.
- `feature/export · 1 commit not pushed`: the branch tracks `origin/feature/export` and is ahead of it.

A toast says whether the push worked, or the line from git that says why not. The plugin checks git after each turn and every 5 seconds, so commits made with the app's Commit button or in a terminal show up too. The push runs with your own git credentials and never waits on a terminal prompt. Claude Code runs git for plugins with the repository's hooks off, so a `pre-push` hook does not run on this push.

### Pull requests (Azure DevOps)

When `origin` is an Azure DevOps repository (Azure DevOps Server, such as `https://server/tfs/Collection/Project/_git/Repo`, or Azure DevOps Services) and the branch is on it with nothing left to push, the line shows **Create PR**:

1. Claude drafts a title and description from the conversation and the branch's commits. A Jira key named in the conversation starts the title.
2. The draft opens in the Pull request pane: edit the title, ask for a revision in your own words, then press **Create pull request**. It targets the repository's default branch.
3. A note in the conversation records the pull request, so Claude and `jira-log`'s next update know it is up.

From then on the line follows the pull request, checking every minute: `PR #12 · Active · 1 of 2 approved · checks running`. Conflicts, a rejection or a failed check turn it red, changes requested yellow, and a merged pull request shows **Merged** in the merge purple. `PR #12` opens it in the browser. A pull request opened in the browser shows up too.

Signing in needs no setup. The plugin asks git for the credential it uses for `origin` (`git credential fill`), then sends requests through Windows PowerShell: first as Basic sign-in (a personal access token), then as Windows sign-in with the same credential (a domain password), and with no stored credential as your Windows account. The credential stays in memory and goes to PowerShell on its standard input, never on a command line. Requests use REST API version 7.0, which Azure DevOps Server 2022 and later answer. Pull requests need Windows.

When both plugins are installed, their lines stack in the band above the prompt.

## worktree-hooks

A third plugin in this marketplace: create every worktree from a freshly fetched `origin/<default branch>`, so it never starts from a stale local copy.

```
/plugin install worktree-hooks@auto-jira-log
```

It registers `WorktreeCreate` and `WorktreeRemove` command hooks. A `WorktreeCreate` hook replaces Claude Code's own worktree creation, so `worktree-create.sh` does all of it:

1. Finds the main checkout and the default branch from `origin/HEAD` (`main` when that is not set).
2. Runs `git fetch origin <branch>`. When the fetch fails, for example offline, it carries on from the cached `origin/<branch>`.
3. Runs `git worktree add` for `.claude/worktrees/<name>` on a new branch, `worktree-<name>`, from `origin/<branch>`.

`worktree-remove.sh` removes the worktree and deletes its `worktree-*` branch, because Claude Code never deletes the branch of a worktree a hook created.

Things to know:

- The hooks run in every repository where the plugin is enabled, and a broken script stops worktrees from being created in all of them.
- `.worktreeinclude` is not processed when a hook creates the worktree, so files such as `.env` are not copied across.
- Add `.claude/worktrees/` to the repository's `.gitignore`.
- The scripts run under `bash` (Git Bash on Windows). If `bash` on your PATH is WSL's, they run in the wrong environment.
- The hooks fire for `claude --worktree`, `isolation: "worktree"` subagents and background sessions. Whether the desktop app's Code tab worktrees fire them is not documented: check that a new worktree's branch is named `worktree-<name>`.

## Develop

```
claude plugin validate plugins/jira-log
claude plugin test plugins/jira-log
claude --plugin-dir plugins/jira-log
```

The same commands work for `plugins/git-push` and `plugins/worktree-hooks`.
