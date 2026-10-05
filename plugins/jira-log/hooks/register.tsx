import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { JiraIssue, JiraUpdate, JiraView } from '../types'
import {
  addOnce,
  ANSWER_SHAPE,
  COMMIT,
  dayOf,
  EMPTY_ACTIVITY,
  OPEN,
  parseUpdate,
  POWERSHELL,
  PR_CREATE,
  PR_URL,
  reasonOf,
  relativeTo,
  SEAL,
  TEST_RUN,
  toDocument,
  toIssue,
  toMarkdown,
  type DailyComment,
  type DayActivity,
  type JiraConfig,
  type RawComment,
  type RawIssue,
} from './format'

type Engine = EngineInterface

const PANE = 'jira'
const USAGE = 'Usage: /jira [setup | link [KEY] | unlink | update]'

const view = atom({ plugin: 'jira-log', key: 'view' } as const, 'setup')
const isConfigured = atom({ plugin: 'jira-log', key: 'isConfigured' } as const, false)
const isSkipped = atom({ plugin: 'jira-log', key: 'isSkipped' } as const, false)
const link = atom({ plugin: 'jira-log', key: 'link' } as const, null)
const issues = atom({ plugin: 'jira-log', key: 'issues' } as const, [])
const draft = atom({ plugin: 'jira-log', key: 'draft' } as const, null)
const busy = atom({ plugin: 'jira-log', key: 'busy' } as const, null)
const notice = atom({ plugin: 'jira-log', key: 'notice' } as const, null)

type SetupField = 'site' | 'email' | 'token'
const SETUP_LABELS: Record<SetupField, string> = { site: 'site URL', email: 'email', token: 'API token' }

// Typed into the setup form but not yet saved; kept out of $.state so the token never lands there.
const typed: Partial<Record<SetupField, string>> = {}
let opened: { blob: string; token: string } | undefined
// The store is read-modify-write, and parallel tool calls finish together.
let recording: Promise<void> = Promise.resolve()

async function powershell($: Engine, script: string, stdin: string, what: string) {
  const { exitCode, stdout, stderr } = await $.process.run([...POWERSHELL, script], { stdin })
  if (exitCode !== 0) {
    throw new Error(`could not ${what} the API token: ${stderr.trim().split('\n')[0]}`)
  }

  return stdout.trim()
}

async function jira<T>($: Engine, config: JiraConfig, method: string, path: string, body?: unknown) {
  if (opened?.blob !== config.tokenBlob) {
    opened = { blob: config.tokenBlob, token: await powershell($, OPEN, config.tokenBlob, 'decrypt') }
  }
  const response = await $.http.fetch(`${config.site}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${btoa(`${config.email}:${opened.token}`)}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Jira answered ${response.status} to ${method} ${path}: ${reasonOf(response.text)}`)
  }

  return JSON.parse(response.text) as T
}

async function whoAmI($: Engine, config: JiraConfig) {
  return (await jira<{ displayName: string }>($, config, 'GET', '/rest/api/3/myself')).displayName
}

async function myOpenIssues($: Engine, config: JiraConfig) {
  const found = await jira<{ issues: RawIssue[] }>($, config, 'POST', '/rest/api/3/search/jql', {
    jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
    fields: ['summary', 'status'],
    maxResults: 30,
  })

  return found.issues.map(toIssue)
}

async function getIssue($: Engine, config: JiraConfig, key: string) {
  const path = `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status`

  return toIssue(await jira<RawIssue>($, config, 'GET', path))
}

// One comment per issue per day: today's earlier comment is replaced, unless
// someone changed it in Jira since it was posted, in which case a new one is added.
async function saveDailyComment(
  $: Engine,
  config: JiraConfig,
  key: string,
  day: string,
  update: JiraUpdate,
  previous: DailyComment | undefined,
): Promise<DailyComment> {
  const comments = `/rest/api/3/issue/${encodeURIComponent(key)}/comment`
  const body = { body: toDocument(day, update) }
  if (previous !== undefined) {
    const current = await jira<RawComment>($, config, 'GET', `${comments}/${previous.id}`).catch(
      () => undefined,
    )
    if (current?.updated === previous.updated) {
      const saved = await jira<RawComment>($, config, 'PUT', `${comments}/${previous.id}`, body)

      return { id: saved.id, updated: saved.updated, update }
    }
  }
  const saved = await jira<RawComment>($, config, 'POST', comments, body)

  return { id: saved.id, updated: saved.updated, update }
}

const activityKey = (issue: string, day: string) => `activity:${issue}:${day}`

async function readActivity($: Engine, issue: string, day: string) {
  return ((await $.store.get(activityKey(issue, day))) as DayActivity | undefined) ?? EMPTY_ACTIVITY
}

function record($: Engine, issue: string, day: string, change: (activity: DayActivity) => DayActivity) {
  recording = recording
    .then(async () => $.store.set(activityKey(issue, day), change(await readActivity($, issue, day))))
    .catch(error => $.ui.log(`jira-log: could not record activity: ${error}`, { to: 'debug' }))

  return recording
}

async function recordCommand($: Engine, issue: string, command: string, isPassing: boolean, output: string) {
  const day = await today($)
  if (COMMIT.test(command)) {
    if (!isPassing) return
    const { exitCode, stdout } = await $.process.run(['git', 'log', '-1', '--format=%s'])
    const subject = stdout.trim()
    if (exitCode !== 0 || subject === '') return

    return record($, issue, day, activity => ({ ...activity, commits: addOnce(activity.commits, subject, 50) }))
  }
  const pullRequest = PR_CREATE.test(command) ? output.match(PR_URL)?.[0] : undefined
  if (pullRequest !== undefined) {
    return record($, issue, day, activity => ({
      ...activity,
      pullRequests: addOnce(activity.pullRequests, pullRequest, 20),
    }))
  }
  if (TEST_RUN.test(command)) {
    const test = { command: command.slice(0, 120), isPassing }

    return record($, issue, day, activity => ({ ...activity, tests: [...activity.tests, test].slice(-20) }))
  }
}

async function recordEdit($: Engine, issue: string, path: string) {
  const file = relativeTo(await $.session.root(), path)

  return record($, issue, await today($), activity => ({ ...activity, files: addOnce(activity.files, file, 200) }))
}

const loadConfig = async ($: Engine) =>
  ((await $.store.get('config')) ?? {}) as Partial<JiraConfig>

const isComplete = (config: Partial<JiraConfig>): config is JiraConfig =>
  Boolean(config.site && config.email && config.tokenBlob)

async function requireConfig($: Engine) {
  const config = await loadConfig($)
  if (isComplete(config)) return config
  const missing = [
    !config.site && 'site URL',
    !config.email && 'email',
    !config.tokenBlob && 'API token',
  ].filter(Boolean)
  throw new Error(`Jira is not set up yet, missing ${missing.join(', ')}: run /jira setup.`)
}

const loadLinks = async ($: Engine) =>
  ((await $.store.get('links')) ?? {}) as Record<string, JiraIssue>

const commentKey = (issue: string, day: string) => `comment:${issue}:${day}`

const today = async ($: Engine) => dayOf(await $.clock.now())

const showStatus = ($: Engine, issue: JiraIssue | null) =>
  $.ui.status(issue === null ? undefined : `Jira ${issue.key}`)

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function attempt($: Engine, label: string, work: () => Promise<void>) {
  await update($, busy, () => label)
  await update($, notice, () => null)
  try {
    await work()
  } catch (error) {
    await update($, notice, () => message(error))
    $.ui.toast(`Jira: ${message(error)}`)
  } finally {
    await update($, busy, () => null)
  }
}

async function openPane($: Engine, next: JiraView) {
  await update($, view, () => next)
  await $.ui.open({ id: PANE, title: 'Jira', focus: true })
}

async function refresh($: Engine) {
  const config = await loadConfig($)
  await update($, isConfigured, () => isComplete(config))
  const linked = (await loadLinks($))[await $.session.root()] ?? null
  await update($, link, () => linked)
  showStatus($, linked)
}

async function setLink($: Engine, issue: JiraIssue | null) {
  const root = await $.session.root()
  const { [root]: _, ...others } = await loadLinks($)
  await $.store.set('links', issue === null ? others : { ...others, [root]: issue })
  await update($, link, () => issue)
  showStatus($, issue)
}

async function openPicker($: Engine) {
  if (!isComplete(await loadConfig($))) return openPane($, 'setup')
  await openPane($, 'pick')
  await attempt($, 'Loading your open issues...', async () => {
    const found = await myOpenIssues($, await requireConfig($))
    await update($, issues, () => found)
  })
}

async function linkTo($: Engine, issue: JiraIssue) {
  await setLink($, issue)
  await update($, isSkipped, () => false)
  $.ui.toast(`Linked this worktree to ${issue.key}`)
  await $.ui.close({ id: PANE })
}

async function linkByKey($: Engine, key: string) {
  const issue = await getIssue($, await requireConfig($), key.trim().toUpperCase())
  await linkTo($, issue)

  return `Linked this worktree to ${issue.key}: ${issue.summary} [${issue.status}].`
}

async function storeSetting($: Engine, field: SetupField, value: string) {
  const trimmed = value.trim()
  if (trimmed === '') return
  let saved: Partial<JiraConfig>
  if (field === 'token') {
    saved = { ...(await loadConfig($)), tokenBlob: await powershell($, SEAL, trimmed, 'encrypt') }
  } else if (field === 'site') {
    const site = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    if (!site.startsWith('https://')) throw new Error('the site URL must use https.')
    saved = { ...(await loadConfig($)), site: site.replace(/\/+$/, '') }
  } else {
    saved = { ...(await loadConfig($)), email: trimmed }
  }
  await $.store.set('config', saved)
  delete typed[field]
  await update($, isConfigured, () => isComplete(saved))
  $.ui.invalidate('ui.render')
}

async function saveSetting($: Engine, field: SetupField, value: string) {
  await attempt($, 'Saving...', async () => {
    await storeSetting($, field, value)
    await update($, notice, () => `Saved the ${SETUP_LABELS[field]}.`)
  })
}

async function testConnection($: Engine) {
  await attempt($, 'Connecting...', async () => {
    for (const [field, value] of Object.entries(typed) as [SetupField, string][]) {
      await storeSetting($, field, value)
    }
    const name = await whoAmI($, await requireConfig($))
    $.ui.toast(`Connected to Jira as ${name}`)
    if ((await read($, link)) === null) await openPicker($)
    else await update($, notice, () => `Connected as ${name}.`)
  })
}

// The fork reads this session's transcript; before the first reply there is none.
async function ask($: Engine, prompt: string) {
  const forked = await $.model.fork({ prompt })
  const reply =
    !forked.isAnswered && forked.reason === 'nothing-to-fork'
      ? await $.model.complete({ model: await $.session.model(), prompt })
      : forked
  if (!reply.isAnswered) throw new Error(`the model gave no draft (${reply.reason})`)

  return parseUpdate(reply.text)
}

async function draftPrompt($: Engine, issue: JiraIssue, day: string) {
  const activity = await readActivity($, issue.key, day)
  const posted = (await $.store.get(commentKey(issue.key, day))) as DailyComment | undefined
  const earlier = posted
    ? `Already posted today; your draft replaces it, so keep what still holds:\n${JSON.stringify(posted.update)}`
    : 'Nothing has been posted today yet.'

  return [
    `Draft today's progress comment for Jira issue ${issue.key} "${issue.summary}" (${day}).`,
    `Work recorded on this issue today across every Claude Code session:\n${JSON.stringify(activity, null, 2)}`,
    earlier,
    'Use that record and this conversation. Write outcomes a teammate would understand, one short ' +
      'sentence per item. No code, diffs, file contents, secrets or internal hostnames. Leave a list ' +
      'empty when nothing true belongs in it; never invent blockers or achievements.',
    ANSWER_SHAPE,
  ].join('\n\n')
}

async function startDraft($: Engine) {
  const issue = await read($, link)
  if (issue === null) return 'No Jira issue is linked to this worktree: run /jira link first.'
  await requireConfig($)
  await update($, draft, () => null)
  await openPane($, 'draft')
  await attempt($, `Drafting today's update for ${issue.key}...`, async () => {
    const drafted = await ask($, await draftPrompt($, issue, await today($)))
    await update($, draft, () => drafted)
  })

  return `Drafted today's update for ${issue.key}: review it in the Jira pane.`
}

async function revise($: Engine, instruction: string) {
  const current = await read($, draft)
  if (current === null || instruction.trim() === '') return
  await attempt($, 'Revising...', async () => {
    const prompt =
      `This is the current draft of today's Jira comment:\n${JSON.stringify(current)}\n\n` +
      `Revise it as follows: ${instruction.trim()}\n\n${ANSWER_SHAPE}`
    const revised = await ask($, prompt)
    await update($, draft, () => revised)
  })
}

async function post($: Engine) {
  const [issue, current] = [await read($, link), await read($, draft)]
  if (issue === null || current === null) return
  await attempt($, `Posting to ${issue.key}...`, async () => {
    const day = await today($)
    const key = commentKey(issue.key, day)
    const previous = (await $.store.get(key)) as DailyComment | undefined
    const saved = await saveDailyComment($, await requireConfig($), issue.key, day, current, previous)
    await $.store.set(key, saved)
    await update($, draft, () => null)
    $.ui.toast(`${saved.id === previous?.id ? 'Updated' : 'Posted'} today's comment on ${issue.key}`)
    await $.ui.close({ id: PANE })
  })
}

async function discard($: Engine) {
  await update($, draft, () => null)
  await $.ui.close({ id: PANE })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'jira',
      description: "Link this worktree to a Jira issue and post today's update",
      argumentHint: '[setup | link [KEY] | unlink | update]',
    })
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'jira' }, async ($, e) => {
    const [verb = '', argument = ''] = e.args.trim().split(/\s+/)
    try {
      switch (verb.toLowerCase()) {
        case 'setup':
          await openPane($, 'setup')
          return { text: 'Jira setup is open in the Jira pane.' }
        case 'link':
          if (argument !== '') return { text: await linkByKey($, argument) }
          await openPicker($)
          return { text: 'Pick an issue in the Jira pane.' }
        case 'unlink':
          await setLink($, null)
          return { text: 'This worktree is no longer linked to a Jira issue.' }
        case 'update':
          return { text: await startDraft($) }
        case '': {
          const issue = await read($, link)
          if (!isComplete(await loadConfig($))) return { text: 'Jira is not set up yet: run /jira setup.' }
          return {
            text:
              issue === null
                ? 'No Jira issue is linked to this worktree: run /jira link.'
                : `Linked to ${issue.key}: ${issue.summary} [${issue.status}]. Run /jira update to draft today's comment.`,
          }
        }
        default:
          return { text: USAGE }
      }
    } catch (error) {
      return { text: `Jira: ${message(error)}` }
    }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    const issue = await read($, link)
    if (issue !== null && ran.deny === undefined && ran.isError !== true) {
      void recordEdit($, issue.key, e.file_path)
    }

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    const issue = await read($, link)
    if (issue !== null && ran.deny === undefined && ran.isError !== true) {
      void recordEdit($, issue.key, e.file_path)
    }

    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const issue = await read($, link)
    if (issue !== null && ran.deny === undefined) {
      void recordCommand($, issue.key, e.command, ran.isError !== true, ran.text ?? '')
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const isHidden = e.props.hasSurvey || (await read($, link)) !== null || (await read($, isSkipped))
    if (isHidden) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isReady = await read($, isConfigured)

    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{isReady ? 'Jira: no issue linked to this worktree' : 'Jira log is not set up'}</Text>
        <Button
          key="link"
          label={isReady ? 'Pick issue' : 'Set up'}
          variant="primary"
          onPress={() => void (isReady ? openPicker($) : openPane($, 'setup'))}
        />
        <Button key="skip" label="Skip" onPress={() => void update($, isSkipped, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>The Jira pane needs the terminal or the desktop app.</Text>
    }
    const { Box, Button, Input, Markdown, Select, Text } = $.ui.resolve(e)
    const working = await read($, busy)
    const said = await read($, notice)
    const footer = [
      working !== null && <Text dimColor>{working}</Text>,
      said !== null && <Text color="yellow">{said}</Text>,
    ]
    const current = await read($, view)

    if (current === 'setup') {
      const config = await loadConfig($)

      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Jira Cloud connection</Text>
          <Input
            key="site"
            label="Site URL  "
            placeholder="https://your-team.atlassian.net"
            value={typed.site ?? config.site}
            onInput={value => void (typed.site = value)}
            onSubmit={value => void saveSetting($, 'site', value)}
          />
          <Input
            key="email"
            label="Email     "
            placeholder="the email you sign in to Jira with"
            value={typed.email ?? config.email}
            onInput={value => void (typed.email = value)}
            onSubmit={value => void saveSetting($, 'email', value)}
          />
          <Input
            key="token"
            label="API token "
            placeholder={
              config.tokenBlob
                ? 'saved and encrypted; paste a new one to replace it'
                : 'create one at id.atlassian.com > Security > API tokens'
            }
            onInput={value => void (typed.token = value)}
            onSubmit={value => void saveSetting($, 'token', value)}
          />
          <Button
            key="test"
            label="Save and test connection"
            variant="primary"
            onPress={() => void testConnection($)}
          />
          {footer}
        </Box>
      )
    }

    if (current === 'pick') {
      const list = await read($, issues)

      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Link this worktree to one of your open issues</Text>
          {list.length > 0 && (
            <Select
              key="issue"
              options={list.map(issue => ({
                value: issue.key,
                label: `${issue.key}  ${issue.summary}  [${issue.status}]`,
              }))}
              onSelect={key => {
                const issue = list.find(one => one.key === key)
                if (issue !== undefined) void linkTo($, issue)
              }}
            />
          )}
          {working === null && list.length === 0 && <Text dimColor>No open issues are assigned to you.</Text>}
          <Input
            key="by-key"
            label="Or a key "
            placeholder="PROJ-123"
            submitLabel="link"
            onSubmit={value => void attempt($, `Looking up ${value}...`, () => linkByKey($, value).then(() => {}))}
          />
          <Button key="cancel" label="Cancel" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
          {footer}
        </Box>
      )
    }

    const issue = await read($, link)
    const drafted = await read($, draft)

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>{issue === null ? 'No linked issue' : `${issue.key}: today's update`}</Text>
        {drafted !== null && <Markdown text={toMarkdown(drafted)} />}
        {drafted !== null && working === null && (
          <Box flexDirection="column" gap={1}>
            <Input
              key="revise"
              label="Revise "
              placeholder="e.g. add a blocker: waiting on staging access"
              submitLabel="revise"
              onSubmit={value => void revise($, value)}
            />
            <Box flexDirection="row" gap={2}>
              <Button key="post" label="Post to Jira" variant="primary" onPress={() => void post($)} />
              <Button key="discard" label="Discard" role="dismiss" onPress={() => void discard($)} />
            </Box>
          </Box>
        )}
        {footer}
      </Box>
    )
  })
}
