import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  isReviewTool,
  parseSuggestion,
  parseUpdate,
  relativeTo,
  reviewRequestOf,
  toDescription,
  toDocument,
} from '../hooks/format'

const CONFIG = { site: 'https://team.atlassian.net', email: 'me@example.com', tokenBlob: 'sealed' }
const MOVES = [
  { id: '21', name: 'Start work', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
  { id: '31', name: 'Send to review', to: { name: 'In Review', statusCategory: { key: 'indeterminate' } } },
]

// Stands in for Jira, PowerShell and the session beneath the plugin; answers with what was sent.
function fakeJira(on: On, entries: Record<string, unknown> = {}) {
  const sent: string[] = []
  const toasts: string[] = []
  const created: { fields: Record<string, unknown> }[] = []
  let status = { name: 'To Do', statusCategory: { key: 'new' } }
  mock.store(on, { config: CONFIG, ...entries })
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'token\n', stderr: '' } }))
  on('session.root', () => ({ value: 'C:\\code\\repo' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return {}
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('http.fetch', ($, e) => {
    const method = e.init?.method ?? 'GET'
    const path = e.url.replace(CONFIG.site, '')
    sent.push(`${method} ${path}`)
    const json = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    const empty = { value: { status: 204, ok: true, headers: {}, text: '' } }
    if (path.endsWith('/transitions') && method === 'GET') return json({ transitions: MOVES })
    if (path.endsWith('/transitions')) {
      const { transition } = JSON.parse(e.init?.body ?? '{}') as { transition: { id: string } }
      status = MOVES.find(one => one.id === transition.id)?.to ?? status
      return empty
    }
    if (path.includes('/createmeta/')) {
      return json({ issueTypes: [{ name: 'Story', subtask: false }, { name: 'Task', subtask: false }, { name: 'Sub-task', subtask: true }] })
    }
    if (path === '/rest/api/3/myself') return json({ accountId: 'me-1', displayName: 'Me' })
    if (path.endsWith('/assignee')) return empty
    if (path === '/rest/api/3/issue' && method === 'POST') {
      created.push(JSON.parse(e.init?.body ?? '{}'))
      return json({ key: 'CPC-2' })
    }
    const key = path.match(/\/issue\/([A-Z]+-\d+)/)?.[1] ?? 'CPC-1'
    return json({ key, fields: { summary: 'Build the thing', status } })
  })

  return { sent, toasts, created }
}

const BAND = {
  plugin: 'jira-log',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('the band offers setup until the worktree is linked or skipped', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /not set up/ }))?.text).toBe('Jira log is not set up')
    expect((await ui.find({ key: 'link' }))?.props.label).toBe('Set up')
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'skip' })
  expect(await ui.find({ key: 'link' })).toBeUndefined()
  expect(await ui.find({ key: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('the setup button saves what was typed without Enter', async ($, on) => {
  mock.store(on)
  on('ui.toast', () => ({}))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'jira-log',
      surface,
      component: 'Pane',
      requestId: 'jira',
      props: { title: 'Jira', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 } },
    })
    await ui.input({ key: 'site', text: 'team.atlassian.net', kind: 'change' })
    await ui.input({ key: 'email', text: 'me@example.com', kind: 'change' })
    await ui.press({ key: 'test' })

    // The https:// prefix is added on save, so seeing it means the value went through the store.
    expect((await ui.find({ key: 'site' }))?.props.value).toBe('https://team.atlassian.net')
    expect((await ui.find({ key: 'email' }))?.props.value).toBe('me@example.com')
    expect((await ui.find({ type: 'Text', text: /missing/ }))?.text).toBe(
      'Jira is not set up yet, missing API token: run /jira setup.',
    )
    await ui.unmount()
  }
})

test('linking a To Do issue moves it to In Progress', async ($, on) => {
  const { sent, toasts } = fakeJira(on)

  const { text } = await $.command.run({ command: 'jira', args: 'link cpc-1' })

  expect(text).toBe('Linked this worktree to CPC-1: Build the thing [To Do].')
  expect(sent).toContain('POST /rest/api/3/issue/CPC-1/transitions')
  expect(toasts).toContain('Moved CPC-1 to In Progress (work started)')
})

test('a pull request is a clue for the update, and the issue moves only when the person confirms', async ($, on) => {
  const linked = { key: 'CPC-1', summary: 'Build the thing', status: 'In Progress', statusCategory: 'indeterminate' }
  const { sent, toasts } = fakeJira(on, { links: { 'C:\\code\\repo': linked } })
  const clock = mock.clock(on)
  const prompts: string[] = []
  const url = 'https://devops.example.com/tfs/Apps/_git/repo/pullrequest/42'
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: `{"url": "${url}"}`, stderr: '', interrupted: false },
    text: `{"url": "${url}"}`,
  }))
  on('model.fork', ($, e) => {
    prompts.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: '{"completed": ["Opened the pull request"], "pending": [], "blockers": [], "achievements": [], ' +
          '"move": {"to": "in review", "reason": "A pull request was opened."}}',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  await $.session.start({ cwd: 'C:\\code\\repo', surface: 'terminal', isInteractive: true })

  await $.tool.call({ tool: 'Bash', command: 'az repos pr create --title "Export"' })
  await clock.settle()
  await $.command.run({ command: 'jira', args: 'update' })
  const pane = await $.ui.mount({
    plugin: 'jira-log',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'jira',
    props: { title: 'Jira', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 } },
  })

  expect(prompts[0]).toContain(url)
  expect(sent.some(line => line.startsWith('POST'))).toBe(false)
  expect((await pane.find({ key: 'accept-move' }))?.props.label).toBe('Move to In Review')

  await pane.press({ key: 'accept-move' })
  await pane.unmount()

  expect(sent.filter(line => line.startsWith('POST'))).toEqual(['POST /rest/api/3/issue/CPC-1/transitions'])
  expect(toasts).toContain('Moved CPC-1 to In Review')
})

test('pull and merge requests are recognised whatever opened them', async () => {
  const github = 'https://github.com/me/repo/pull/7'

  expect(reviewRequestOf('gh pr create --fill', `Creating...\n${github}\n`)).toBe(github)
  expect(reviewRequestOf('glab mr create -f', 'no url printed')).toBe('glab mr create')
  expect(reviewRequestOf('git push origin HEAD', github)).toBeUndefined()
  expect(isReviewTool('mcp__github__create_pull_request')).toBe(true)
  expect(isReviewTool('mcp__azure-devops__repo_create_pull_request')).toBe(true)
  expect(isReviewTool('mcp__gitlab__create_merge_request')).toBe(true)
  expect(isReviewTool('mcp__github__list_pull_requests')).toBe(false)
})

test('a suggested move must be one the workflow allows from here', async () => {
  const moves = [{ id: '31', name: 'Review', to: 'In Review' }]
  const reply = (to: string) => `{"move": {"to": "${to}", "reason": "PR opened."}}`

  expect(parseSuggestion(reply('In Review'), moves, 'In Progress')).toEqual({ id: '31', to: 'In Review', reason: 'PR opened.' })
  expect(parseSuggestion(reply('Done'), moves, 'In Progress')).toBeNull()
  expect(parseSuggestion(reply(''), moves, 'In Progress')).toBeNull()
  expect(parseSuggestion('{"completed": []}', moves, 'In Progress')).toBeNull()
})

test('a drafted issue is created, assigned, linked and started', async ($, on) => {
  const { sent, toasts, created } = fakeJira(on, { config: { ...CONFIG, project: 'CPC' } })
  on('model.fork', () => ({
    value: {
      isAnswered: true,
      text: '{"summary": "Add CSV export", "description": "Export the report.\\n\\n- CSV first"}',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }))

  await $.command.run({ command: 'jira', args: 'new' })
  const pane = await $.ui.mount({
    plugin: 'jira-log',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'jira',
    props: { title: 'Jira', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 } },
  })
  expect((await pane.find({ key: 'type' }))?.props.value).toBe('Task')
  await pane.press({ key: 'create' })
  await pane.unmount()

  expect(created[0]?.fields).toEqual({
    project: { key: 'CPC' },
    summary: 'Add CSV export',
    issuetype: { name: 'Task' },
    description: {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Export the report.' }] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'CSV first' }] }] }],
        },
      ],
    },
  })
  expect(sent).toContain('PUT /rest/api/3/issue/CPC-2/assignee')
  expect(sent).toContain('POST /rest/api/3/issue/CPC-2/transitions')
  expect(toasts).toContain('Linked this worktree to CPC-2')
})

test('a description becomes paragraphs and bullet lists', async () => {
  const document = toDescription('Add the export.\n\n- CSV first\n- then XLSX\n\nDone when\nboth download.')

  expect(document.content.map(block => block.type)).toEqual(['paragraph', 'bulletList', 'paragraph'])
  expect(document.content[2]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Done when both download.' }] })
})

test('a fenced model reply parses into the four lists', async () => {
  const reply = '```json\n{"completed": ["Shipped the parser"], "blockers": "none", "pending": [1, "Docs"]}\n```'

  expect(parseUpdate(reply)).toEqual({
    completed: ['Shipped the parser'],
    pending: ['Docs'],
    blockers: [],
    achievements: [],
  })
})

test('the comment body leaves out empty sections', async () => {
  const document = toDocument('2026-10-05', {
    completed: ['Shipped the parser'],
    pending: [],
    blockers: [],
    achievements: [],
  })

  expect(document.content.length).toBe(3)
  expect(document.content[1]).toEqual({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Completed' }] })
})

test('edited paths are recorded relative to the worktree', async () => {
  expect(relativeTo('C:\\code\\repo', 'c:\\code\\repo\\src\\a.ts')).toBe('src/a.ts')
  expect(relativeTo('C:\\code\\repo', 'D:\\elsewhere\\b.ts')).toBe('D:/elsewhere/b.ts')
})
