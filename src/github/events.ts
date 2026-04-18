import crypto from 'crypto'

export type EventSource = 'bugbot' | 'codeql' | 'ci' | 'bot' | 'human' | 'other'
export type EventType = 'comment' | 'check_failure' | 'review'

export interface SentinelEvent {
  id: string
  repo: string
  prNumber: number
  prTitle: string
  prUrl: string
  prAuthor: string
  eventType: EventType
  source: EventSource
  actor: string
  body?: string
  githubUrl: string
  receivedAt: Date
}

export interface EventBatch {
  repo: string
  prNumber: number
  events: SentinelEvent[]
}

export interface PRMeta {
  prTitle: string
  prUrl: string
  prAuthor?: string
}

export function classifyCheckAsScannerBot(
  checkName: string,
  appSlug: string | undefined,
  scannerLogins: string[]
): string | null {
  if (appSlug && scannerLogins.some(l => l.includes(appSlug))) {
    return scannerLogins.find(l => l.includes(appSlug)) ?? null
  }

  const nameLower = checkName.toLowerCase()
  if (nameLower.includes('bugbot')) return scannerLogins.find(l => l.toLowerCase().includes('bugbot')) ?? null
  if (nameLower.includes('codeql')) {
    return scannerLogins.find(l =>
      l.toLowerCase().includes('codeql') || l.toLowerCase().includes('github-advanced-security')
    ) ?? null
  }

  return null
}

export function classifySource(login: string, type: string): EventSource {
  const loginLower = login.toLowerCase()
  // Cursor's BugBot posts as `cursor[bot]` (current) or `cursor-bugbot[bot]`
  // (legacy). Match both so it's surfaced as a scanner finding, not a
  // generic bot comment.
  if (
    loginLower.includes('bugbot') ||
    loginLower === 'cursor[bot]' ||
    loginLower.startsWith('cursor-bugbot')
  ) {
    return 'bugbot'
  }
  if (loginLower.includes('codeql') || loginLower.includes('github-advanced-security')) return 'codeql'
  if (type === 'Bot') return 'bot'
  return 'human'
}

export interface GitHubComment {
  id: number
  user: { login: string; type: string } | null
  body: string | null
  html_url: string
  created_at: string
}

export function normalizeScannerComment(
  comment: GitHubComment,
  repo: string,
  prNumber: number,
  meta: PRMeta
): SentinelEvent {
  const login = comment.user?.login ?? 'unknown'
  const source = classifySource(login, comment.user?.type ?? '')
  const body = comment.body ? comment.body.slice(0, 500) : undefined

  const id = crypto.createHash('sha256')
    .update(`${repo}:comment:${comment.id}`)
    .digest('hex')

  return {
    id,
    repo,
    prNumber,
    prTitle: meta.prTitle,
    prUrl: meta.prUrl,
    prAuthor: meta.prAuthor ?? '',
    eventType: 'comment',
    source,
    actor: login,
    body,
    githubUrl: comment.html_url,
    receivedAt: new Date(comment.created_at),
  }
}
