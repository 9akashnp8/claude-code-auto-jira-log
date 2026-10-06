# claude-code-auto-jira-log

A Claude Code plugin that keeps Jira Cloud up to date with the work you do in Claude Code.

- **Link** a worktree to a Jira issue: pick one of your open issues, type a key, or create a new issue drafted from the conversation.
- **Record** the day's work on that issue as you go: files edited, commits, test runs, pull requests.
- **Post** one daily comment per issue (Completed, Pending, Blockers, Achievements), drafted by Claude from that record and the conversation, and reviewed by you before it is sent.
- **See** at a glance whether today's work is in Jira: a line above the prompt shows the linked issue, its status, and how many actions are recorded but not yet posted, with a button to draft the update.
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

Linking a To Do issue looks for a transition into a status named In Progress (any case); when the workflow has none, a toast says so and the issue stays where it is.

`/jira update` only suggests moves the issue's workflow allows from its current status, and nothing moves until you press the button. Its evidence is the conversation and the day's record, which notes pull and merge requests opened from Claude Code by `gh pr create`, `glab mr create`, `az repos pr create`, or an MCP tool such as `create_pull_request`. A pull request opened in the browser counts once you mention it in the conversation.

## Develop

```
claude plugin validate plugins/jira-log
claude plugin test plugins/jira-log
claude --plugin-dir plugins/jira-log
```
