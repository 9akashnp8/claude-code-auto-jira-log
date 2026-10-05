import type { JiraIssue, JiraUpdate } from '../types'

export type JiraConfig = { site: string; email: string; tokenBlob: string }

export type DailyComment = { id: string; updated: string; update: JiraUpdate }

export type DayActivity = {
  files: string[]
  commits: string[]
  tests: { command: string; isPassing: boolean }[]
  pullRequests: string[]
}

export type RawIssue = {
  key: string
  fields: { summary: string; status: { name: string; statusCategory: { key: string } } }
}

export type RawComment = { id: string; updated: string }

export const EMPTY_ACTIVITY: DayActivity = { files: [], commits: [], tests: [], pullRequests: [] }

export const TEST_RUN =
  /\b(pytest|vitest|jest|mocha|unittest|go test|cargo test|(?:npm|pnpm|yarn|bun)(?: run)? test)\b/
export const COMMIT = /\bgit\s+commit\b/
export const PR_CREATE = /\bgh\s+pr\s+create\b/
export const PR_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/

// DPAPI: a sealed blob opens only for this Windows user on this machine.
export const POWERSHELL = ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command']
export const SEAL =
  '$t = [Console]::In.ReadToEnd().Trim(); ' +
  'ConvertTo-SecureString -String $t -AsPlainText -Force | ConvertFrom-SecureString'
export const OPEN =
  '$b = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString -String $b; ' +
  '[Runtime.InteropServices.Marshal]::PtrToStringBSTR(' +
  '[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))'

export const ANSWER_SHAPE =
  'Answer with only this JSON object and nothing else:\n' +
  '{"completed": [], "pending": [], "blockers": [], "achievements": []}'

const SECTIONS = [
  ['completed', 'Completed'],
  ['pending', 'Pending'],
  ['blockers', 'Blockers'],
  ['achievements', 'Achievements'],
] as const

export const toIssue = ({ key, fields }: RawIssue): JiraIssue => ({
  key,
  summary: fields.summary,
  status: fields.status.name,
  statusCategory: fields.status.statusCategory.key,
})

export function reasonOf(text: string) {
  try {
    const body = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string> }
    const reasons = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})]
    if (reasons.length > 0) return reasons.join('; ')
  } catch {}

  return text.slice(0, 200)
}

export function dayOf(now: number) {
  const date = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function relativeTo(root: string, path: string) {
  const [file, base] = [path.replaceAll('\\', '/'), `${root.replaceAll('\\', '/')}/`]

  return file.toLowerCase().startsWith(base.toLowerCase()) ? file.slice(base.length) : file
}

export const addOnce = (list: string[], item: string, limit: number) =>
  list.includes(item) ? list : [...list, item].slice(-limit)

export function parseUpdate(reply: string): JiraUpdate {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  const parsed = JSON.parse(reply.slice(start, end + 1)) as Partial<Record<keyof JiraUpdate, unknown>>
  const listOf = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

  return {
    completed: listOf(parsed.completed),
    pending: listOf(parsed.pending),
    blockers: listOf(parsed.blockers),
    achievements: listOf(parsed.achievements),
  }
}

export const toMarkdown = (update: JiraUpdate) =>
  SECTIONS.filter(([field]) => update[field].length > 0)
    .map(([field, title]) => `#### ${title}\n${update[field].map(item => `- ${item}`).join('\n')}`)
    .join('\n\n') || '_Nothing to report._'

const text = (value: string, isStrong = false) =>
  isStrong ? { type: 'text', text: value, marks: [{ type: 'strong' }] } : { type: 'text', text: value }

// Comment bodies in the v3 API are Atlassian Document Format, not markdown.
export function toDocument(day: string, update: JiraUpdate) {
  const sections = SECTIONS.filter(([field]) => update[field].length > 0).flatMap(([field, title]) => [
    { type: 'heading', attrs: { level: 4 }, content: [text(title)] },
    {
      type: 'bulletList',
      content: update[field].map(item => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [text(item)] }],
      })),
    },
  ])

  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [text(`Daily update ${day}`, true)] }, ...sections],
  }
}
