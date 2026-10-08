import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { failureOf, POLL_MS } from '../hooks/git'

type Repo = { branch: string; upstream: string | null; ahead: number; pushError: string | null }

// Stands in for git and the session beneath the plugin; a push publishes the branch unless pushError is set.
function fakeGit(on: On, start: Partial<Repo> = {}) {
  const repo: Repo = { branch: 'feature/export', upstream: 'origin/main', ahead: 2, pushError: null, ...start }
  const ran: string[] = []
  const toasts: string[] = []
  const clock = mock.clock(on)
  const answer = (exitCode: number, stdout = '', stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', ($, e) => {
    const command = e.argv.slice(1).join(' ')
    ran.push(command)
    if (command === 'rev-parse --abbrev-ref HEAD') return answer(0, `${repo.branch}\n`)
    if (command === 'remote get-url origin') return answer(0, 'https://dev.azure.com/team/_git/repo\n')
    if (command.endsWith('@{u}')) return repo.upstream === null ? answer(128, '', 'fatal: no upstream') : answer(0, `${repo.upstream}\n`)
    if (command.startsWith('rev-list --count')) return answer(0, `${repo.ahead}\n`)
    if (command.startsWith('push')) {
      if (repo.pushError !== null) return answer(1, '', repo.pushError)
      repo.upstream = `origin/${repo.branch}`
      repo.ahead = 0
      return answer(0, '', 'To https://dev.azure.com/team/_git/repo\n')
    }
    return answer(1, '', `unexpected: git ${command}`)
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // What the plugins beneath draw in the band, such as jira-log's line.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Box({ key: 'beneath' }))

  return { repo, ran, toasts, clock }
}

const BAND = {
  plugin: 'git-push',
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

const SESSION = { cwd: 'C:\\code\\repo', isInteractive: true } as const

test('a new branch with commits offers a push that publishes it', async ($, on) => {
  const { ran, toasts, clock } = fakeGit(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.session.start({ ...SESSION, surface })
    const band = await $.ui.mount({ ...BAND, surface })

    expect((await band.find({ type: 'Text', text: /feature/ }))?.text).toBe('feature/export · not on origin yet · 2 commits')
    expect(await band.find({ key: 'beneath' })).toBeDefined()
    if (surface === 'desktop') {
      await band.press({ key: 'push' })
      await clock.settle()

      expect(ran).toContain('push --set-upstream origin HEAD')
      expect(toasts).toEqual(['Pushed feature/export to origin'])
      expect(await band.find({ key: 'push' })).toBeUndefined()
      expect(await band.find({ key: 'beneath' })).toBeDefined()
    }
    await band.unmount()
  }
})

test('the band stays out of the way while there is nothing to push', async ($, on) => {
  fakeGit(on, { upstream: 'origin/feature/export', ahead: 0 })
  await $.session.start({ ...SESSION, surface: 'terminal' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await band.find({ key: 'push' })).toBeUndefined()
  expect(await band.find({ key: 'beneath' })).toBeDefined()
  await band.unmount()
})

test('a commit made outside Claude shows up on the next poll', async ($, on) => {
  const { repo, clock } = fakeGit(on, { upstream: 'origin/feature/export', ahead: 0 })
  await $.session.start({ ...SESSION, surface: 'terminal' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ key: 'push' })).toBeUndefined()

  repo.ahead = 1
  await clock.advance(POLL_MS)

  expect((await band.find({ type: 'Text', text: /feature/ }))?.text).toBe('feature/export · 1 commit not pushed')
  expect(await band.find({ key: 'push' })).toBeDefined()
  await band.unmount()
})

test('a rejected push says why and keeps the button', async ($, on) => {
  const rejected = [
    'To https://dev.azure.com/team/_git/repo',
    ' ! [rejected]        HEAD -> feature/export (fetch first)',
    "error: failed to push some refs to 'https://dev.azure.com/team/_git/repo'",
    'hint: Updates were rejected because the remote contains work that you do not',
  ].join('\n')
  const { toasts, clock } = fakeGit(on, { upstream: 'origin/feature/export', ahead: 1, pushError: rejected })
  await $.session.start({ ...SESSION, surface: 'terminal' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  await band.press({ key: 'push' })
  await clock.settle()

  expect(toasts).toEqual([
    "Push failed: ! [rejected]        HEAD -> feature/export (fetch first) error: failed to push some refs to 'https://dev.azure.com/team/_git/repo'",
  ])
  expect(await band.find({ key: 'push' })).toBeDefined()
  await band.unmount()
})

test('a failure with no error line falls back to git’s last line', async () => {
  expect(failureOf('Logon failed, use ctrl+c to cancel basic credential prompt.\n')).toBe(
    'Logon failed, use ctrl+c to cancel basic credential prompt.',
  )
  expect(failureOf('')).toBe('git exited with an error')
})
