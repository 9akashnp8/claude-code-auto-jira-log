import { expect, mock, test } from 'claude-code/testing'

import { parseUpdate, relativeTo, toDocument } from '../hooks/format'

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
