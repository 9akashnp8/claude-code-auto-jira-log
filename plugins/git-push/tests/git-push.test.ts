import { expect, test } from 'claude-code/testing'

import { failureOf, POLL_MS } from '../hooks/git'
import { BAND, fakeGit, SESSION } from './fake'

test('a new branch with commits offers a push that publishes it', async ($, on) => {
  const { ran, toasts, clock } = fakeGit(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    await $.session.start({ ...SESSION, surface })
    const band = await $.ui.mount({ ...BAND, surface })

    expect((await band.find({ type: 'Text', text: /feature/ }))?.text).toBe('feature/export · not on origin yet · 2 commits')
    expect(await band.find({ key: 'beneath' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^─+$/ })).toBeDefined()
    if (surface === 'desktop') {
      await band.press({ key: 'push' })
      await clock.settle()

      expect(ran).toContain('git push --set-upstream origin HEAD')
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

test('alone in the band, the line draws no rule', async ($, on) => {
  fakeGit(on, {}, { isBeneathDrawn: false })
  await $.session.start({ ...SESSION, surface: 'terminal' })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })

  expect(await band.find({ key: 'push' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /^─+$/ })).toBeUndefined()
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
