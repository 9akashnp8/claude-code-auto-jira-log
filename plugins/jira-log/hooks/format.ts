import type { JiraIssue, JiraNewIssue, JiraProgress, JiraSuggestion, JiraTransition, JiraUpdate } from '../types'

export type JiraConfig = { site: string; email: string; tokenBlob: string; project?: string }

// Older comments carry no `actions` or `postedAt`.
export type DailyComment = { id: string; updated: string; update: JiraUpdate; actions?: number; postedAt?: number }

export type DayActivity = {
  files: string[]
  commits: string[]
  tests: { command: string; isPassing: boolean }[]
  // A pull or merge request's URL, or the command or tool that opened it when no URL was printed.
  pullRequests: string[]
  // Every action recorded today, counted even when the lists above dedupe or roll it off; absent on older days.
  actions?: number
}

export type RawIssue = {
  key: string
  fields: { summary: string; status: { name: string; statusCategory: { key: string } } }
}

export type RawComment = { id: string; updated: string }

export type RawTransition = { id: string; name: string; to: { name: string } }

export const IN_PROGRESS = 'In Progress'

export const EMPTY_ACTIVITY: DayActivity = { files: [], commits: [], tests: [], pullRequests: [], actions: 0 }

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const clockOf = (at: number) => {
  const date = new Date(at)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// What the band and status line say about today's work on the linked issue.
export function progressOf(progress: JiraProgress | null, day: string) {
  const current = progress?.day === day ? progress : null
  const actions = current?.actions ?? 0
  const unposted = Math.max(0, actions - (current?.postedActions ?? 0))
  if (current?.postedAt == null) {
    return actions === 0
      ? { tone: 'quiet', text: 'nothing recorded today', short: '' }
      : { tone: 'due', text: `${plural(actions, 'action')} today, not in Jira yet`, short: `${actions} unposted` }
  }
  if (unposted === 0) {
    return { tone: 'done', text: `✓ today's update posted ${clockOf(current.postedAt)}`, short: '✓' }
  }

  return {
    tone: 'due',
    text: `posted ${clockOf(current.postedAt)}, ${plural(unposted, 'action')} since`,
    short: `${unposted} unposted`,
  }
}

export const TEST_RUN =
  /\b(pytest|vitest|jest|mocha|unittest|go test|cargo test|(?:npm|pnpm|yarn|bun)(?: run)? test)\b/
export const COMMIT = /\bgit\s+commit\b/
const REVIEW_COMMAND = /\b(gh\s+pr\s+create|glab\s+mr\s+create|az\s+repos\s+pr\s+create)\b/
const REVIEW_TOOL = /create_?(?:pull_?request|merge_?request)/i
// GitHub /pull/7, GitLab /merge_requests/7, Azure DevOps /pullrequest/7.
const REVIEW_URL = /https?:\/\/[^\s"'<>]+\/(?:pull|merge_requests|pullrequest)\/\d+/

// DPAPI: a sealed blob opens only for this Windows user on this machine.
export const POWERSHELL = ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command']
export const SEAL =
  '$t = [Console]::In.ReadToEnd().Trim(); ' +
  'ConvertTo-SecureString -String $t -AsPlainText -Force | ConvertFrom-SecureString'
export const OPEN =
  '$b = [Console]::In.ReadToEnd().Trim(); $s = ConvertTo-SecureString -String $b; ' +
  '[Runtime.InteropServices.Marshal]::PtrToStringBSTR(' +
  '[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))'

export const UPDATE_SHAPE =
  'Answer with only this JSON object and nothing else:\n' +
  '{"completed": [], "pending": [], "blockers": [], "achievements": []}'

export const UPDATE_AND_MOVE_SHAPE =
  'Answer with only this JSON object and nothing else:\n' +
  '{"completed": [], "pending": [], "blockers": [], "achievements": [], "move": {"to": "", "reason": ""}}'

export const ISSUE_SHAPE =
  'Answer with only this JSON object and nothing else:\n' +
  '{"summary": "", "goal": "", "scope": [], "acceptance": [], "notes": []}'

export function newIssuePrompt(focus: string) {
  const subject = focus
    ? `The person asked for: "${focus}". That decides what the ticket is about. Use this conversation ` +
      'only for details that serve it, and leave out everything else the conversation covered.'
    : 'Base it on the main piece of work in this conversation.'

  return [
    'Draft a Jira ticket: a description of work to be done, not a record of what this conversation did.',
    subject,
    [
      'Rules:',
      '- Write it as work ahead, for a teammate who has not seen the conversation. Never narrate what was ' +
        'discussed, tried or found, or what exists so far; at most one clause of background, inside the goal.',
      '- summary: an imperative title under 80 characters.',
      '- goal: one or two sentences: the outcome wanted and why.',
      '- scope: 2 to 6 deliverables, each one short line starting with a verb.',
      '- acceptance: 2 to 5 checkable outcomes that say when the ticket is done.',
      '- notes: only open questions or constraints someone must know before starting; usually empty.',
      '- Under 150 words in all. No code, file paths, diffs, secrets or internal hostnames.',
    ].join('\n'),
    ISSUE_SHAPE,
  ].join('\n\n')
}

export function reviewRequestOf(command: string, output: string) {
  const opened = command.match(REVIEW_COMMAND)?.[1]

  return opened === undefined ? undefined : (output.match(REVIEW_URL)?.[0] ?? opened.replace(/\s+/g, ' '))
}

export const isReviewTool = (tool: string) => tool.startsWith('mcp__') && REVIEW_TOOL.test(tool)

export const reviewUrlIn = (output: string) => output.match(REVIEW_URL)?.[0]

export const toTransition = ({ id, name, to }: RawTransition): JiraTransition => ({ id, name, to: to.name })

export const isSameStatus = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

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

const objectIn = (reply: string) => JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1))

const listOf = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
    : []

export function parseNewIssue(reply: string, issueType: string): JiraNewIssue {
  const parsed = objectIn(reply) as Partial<Record<keyof JiraNewIssue, unknown>>
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 255) : ''
  if (summary === '') throw new Error('the model drafted no summary')

  return {
    summary,
    goal: typeof parsed.goal === 'string' ? parsed.goal.trim() : '',
    scope: listOf(parsed.scope),
    acceptance: listOf(parsed.acceptance),
    notes: listOf(parsed.notes),
    issueType,
  }
}

// Only a move the workflow allows from here is suggested; anything else the model names is dropped.
export function parseSuggestion(
  reply: string,
  moves: readonly JiraTransition[],
  status: string,
): JiraSuggestion | null {
  const { move } = objectIn(reply) as { move?: { to?: unknown; reason?: unknown } }
  const to = typeof move?.to === 'string' ? move.to : ''
  const transition = moves.find(one => isSameStatus(one.to, to))
  if (to === '' || transition === undefined || isSameStatus(to, status)) return null

  return { id: transition.id, to: transition.to, reason: typeof move?.reason === 'string' ? move.reason.trim() : '' }
}

export function parseUpdate(reply: string): JiraUpdate {
  const parsed = objectIn(reply) as Partial<Record<keyof JiraUpdate, unknown>>

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

const ISSUE_SECTIONS = [
  ['scope', 'Scope'],
  ['acceptance', 'Acceptance criteria'],
  ['notes', 'Notes'],
] as const

export const toIssueMarkdown = (issue: JiraNewIssue) =>
  [
    issue.goal,
    ...ISSUE_SECTIONS.filter(([field]) => issue[field].length > 0).map(
      ([field, title]) => `#### ${title}\n${issue[field].map(item => `- ${item}`).join('\n')}`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n')

const text = (value: string, isStrong = false) =>
  isStrong ? { type: 'text', text: value, marks: [{ type: 'strong' }] } : { type: 'text', text: value }

const headedList = (title: string, items: readonly string[]) => [
  { type: 'heading', attrs: { level: 4 }, content: [text(title)] },
  {
    type: 'bulletList',
    content: items.map(item => ({ type: 'listItem', content: [{ type: 'paragraph', content: [text(item)] }] })),
  },
]

// Comment and description bodies in the v3 API are Atlassian Document Format, not markdown.
export function toDocument(day: string, update: JiraUpdate) {
  const sections = SECTIONS.filter(([field]) => update[field].length > 0).flatMap(([field, title]) =>
    headedList(title, update[field]),
  )

  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [text(`Daily update ${day}`, true)] }, ...sections],
  }
}

export function toIssueDocument(issue: JiraNewIssue) {
  const sections = ISSUE_SECTIONS.filter(([field]) => issue[field].length > 0).flatMap(([field, title]) =>
    headedList(title, issue[field]),
  )
  const goal = issue.goal === '' ? [] : [{ type: 'paragraph', content: [text(issue.goal)] }]

  return { type: 'doc', version: 1, content: [...goal, ...sections] }
}
