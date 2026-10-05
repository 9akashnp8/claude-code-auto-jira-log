export type JiraIssue = { key: string; summary: string; status: string; statusCategory: string }

export type JiraUpdate = {
  completed: string[]
  pending: string[]
  blockers: string[]
  achievements: string[]
}

export type JiraView = 'setup' | 'pick' | 'draft'

declare module 'claude-code' {
  interface PluginState {
    'jira-log': {
      view: JiraView
      isConfigured: boolean
      isSkipped: boolean
      link: JiraIssue | null
      issues: JiraIssue[]
      draft: JiraUpdate | null
      busy: string | null
      notice: string | null
    }
  }
}
