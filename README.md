# claude-code-auto-jira-log

A Claude Code plugin that keeps Jira Cloud up to date with the work you do in Claude Code.

- **Link** a worktree to a Jira issue: pick one of your open issues or type a key.
- **Record** the day's work on that issue as you go: files edited, commits, test runs, pull requests.
- **Post** one daily comment per issue (Completed, Pending, Blockers, Achievements), drafted by Claude from that record and the conversation, and reviewed by you before it is sent.

Built on Claude Code's function hooks (early access); the API can change between Claude Code releases.

## Install

```
/plugin marketplace add 9akashnp8/claude-code-auto-jira-log
/plugin install jira-log@auto-jira-log
```

## Set up

1. Create an API token at id.atlassian.com > Security > API tokens.
2. Run `/jira setup`, fill in your site URL (`https://your-team.atlassian.net`), email and token, then press **Save and test connection**.

The token is encrypted with Windows DPAPI before it is stored, so it opens only for your Windows user on that machine. Token storage needs Windows PowerShell.

## Use

| Command | What it does |
| --- | --- |
| `/jira` | Shows which issue this worktree is linked to |
| `/jira setup` | Opens the connection form |
| `/jira link [KEY]` | Links this worktree to an issue; without a key, opens the picker |
| `/jira unlink` | Removes the link |
| `/jira update` | Drafts today's comment in the Jira pane: revise it, post it or discard it |

Running `/jira update` again on the same day replaces that day's comment, unless someone edited it in Jira since; then a new comment is added.

## Develop

```
claude plugin validate plugins/jira-log
claude plugin test plugins/jira-log
claude --plugin-dir plugins/jira-log
```
