export type JiraIssue = { key: string; summary: string; status: string; statusCategory: string }

export type JiraUpdate = {
  completed: string[]
  pending: string[]
  blockers: string[]
  achievements: string[]
}

export type JiraNewIssue = { summary: string; description: string; issueType: string }

export type JiraTransition = { id: string; name: string; to: string }

export type JiraSuggestion = { id: string; to: string; reason: string }

export type JiraView = 'setup' | 'pick' | 'draft' | 'create' | 'move'

declare module 'claude-code' {
  interface PluginState {
    'jira-log': {
      view: JiraView
      isConfigured: boolean
      isSkipped: boolean
      link: JiraIssue | null
      issues: JiraIssue[]
      draft: JiraUpdate | null
      suggestion: JiraSuggestion | null
      newIssue: JiraNewIssue | null
      issueTypes: string[]
      transitions: JiraTransition[]
      busy: string | null
      notice: string | null
    }
  }
}
