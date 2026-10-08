import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Unpushed } from '../types'
import { describe, failureOf, isSame, NEW_COMMITS, POLL_MS, PUSH, PUSH_TIMEOUT_MS, REMOTE } from './git'

type Engine = EngineInterface

const unpushed = atom({ plugin: 'git-push', key: 'unpushed' } as const, null)
const isPushing = atom({ plugin: 'git-push', key: 'isPushing' } as const, false)

// GIT_TERMINAL_PROMPT: fail rather than wait on a credential prompt nobody can answer.
// GIT_OPTIONAL_LOCKS: the poll never holds the index lock against a commit in progress.
const git = ($: Engine, args: string[], timeoutMs?: number) =>
  $.process.run(['git', ...args], { env: { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, timeoutMs })

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function unpushedOf($: Engine): Promise<Unpushed | null> {
  const head = await git($, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = head.stdout.trim()
  if (head.exitCode !== 0 || branch === 'HEAD') return null
  if ((await git($, ['remote', 'get-url', REMOTE])).exitCode !== 0) return null

  // A worktree branched from origin/main may track origin/main; that is not this branch on origin.
  const tracked = await git($, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  const isPublished = tracked.exitCode === 0 && tracked.stdout.trim() === `${REMOTE}/${branch}`
  const count = await git($, isPublished ? ['rev-list', '--count', '@{u}..HEAD'] : NEW_COMMITS)
  const ahead = count.exitCode === 0 ? Number(count.stdout.trim()) || 0 : 0

  return ahead > 0 ? { branch, isPublished, ahead } : null
}

let refreshing: Promise<void> | null = null

function refresh($: Engine) {
  refreshing ??= (async () => {
    const found = await unpushedOf($).catch(() => null)
    if (!isSame(await read($, unpushed), found)) await update($, unpushed, () => found)
  })().finally(() => {
    refreshing = null
  })

  return refreshing
}

async function push($: Engine) {
  if (await read($, isPushing)) return
  const pending = await read($, unpushed)
  await update($, isPushing, () => true)
  try {
    const { exitCode, stderr } = await git($, PUSH, PUSH_TIMEOUT_MS)
    $.ui.toast(exitCode === 0 ? `Pushed ${pending?.branch ?? 'HEAD'} to ${REMOTE}` : `Push failed: ${failureOf(stderr)}`)
  } catch (error) {
    $.ui.toast(`Push failed: ${message(error)}`)
  } finally {
    await update($, isPushing, () => false)
    await refresh($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)
    $.clock.every(POLL_MS, () => void refresh($))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    void refresh($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const pending = await read($, unpushed)
    const pushing = await read($, isPushing)
    if (pending === null && !pushing) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // The band holds one tree: stack what the plugins beneath draw (jira-log's line) under ours.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {pending !== null && <Text dimColor>{describe(pending)}</Text>}
          {pushing ? (
            <Text dimColor>Pushing…</Text>
          ) : (
            <Button key="push" label="Push" variant="primary" onPress={() => void push($)} />
          )}
        </Box>
        {below}
      </Box>
    )
  })
}
