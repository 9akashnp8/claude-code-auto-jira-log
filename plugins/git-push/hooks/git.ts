import type { Unpushed } from '../types'

export const REMOTE = 'origin'

// How often git is asked again, for commits made outside Claude (the app's Commit button, a terminal).
export const POLL_MS = 5_000

export const PUSH_TIMEOUT_MS = 5 * 60_000

// Commits on HEAD that are on no branch of origin: what a first push of a new branch sends.
export const NEW_COMMITS = ['rev-list', '--count', 'HEAD', '--not', `--remotes=${REMOTE}`]

export const PUSH = ['push', '--set-upstream', REMOTE, 'HEAD']

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export const describe = ({ branch, isPublished, ahead }: Unpushed) =>
  isPublished
    ? `${branch} · ${plural(ahead, 'commit')} not pushed`
    : `${branch} · not on ${REMOTE} yet · ${plural(ahead, 'commit')}`

export const isSame = (a: Unpushed | null, b: Unpushed | null) =>
  a === b || (a !== null && b !== null && a.branch === b.branch && a.isPublished === b.isPublished && a.ahead === b.ahead)

// The lines of git's stderr that say why a push failed, without its hints.
export function failureOf(stderr: string) {
  const lines = stderr.split('\n').map(line => line.trim()).filter(line => line !== '')
  const reasons = lines.filter(line => /^(fatal|error|remote: error):|^!/.test(line))

  return (reasons.length > 0 ? reasons : lines.slice(-1)).join(' ') || 'git exited with an error'
}
