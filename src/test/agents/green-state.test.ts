import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { initDB, closeDB } from '../../db/index.js'
import * as queries from '../../db/queries.js'

vi.mock('../../github/client.js', () => ({
  fetchScannerComments: vi.fn().mockResolvedValue([]),
  getPRMeta: vi.fn().mockResolvedValue({ prTitle: 'Fix auth', prUrl: 'https://...' }),
  postPRComment: vi.fn().mockResolvedValue(undefined),
  deletePRComment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../agents/inject.js', () => ({ injectIntoSession: vi.fn() }))
vi.mock('../../agents/claude-code.js', () => ({ dispatchToClaudeCode: vi.fn() }))

describe('isPRGreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initDB(':memory:')
  })
  afterEach(() => closeDB())

  it('returns false when no checks exist', async () => {
    const { isPRGreen } = await import('../../agents/index.js')
    expect(await isPRGreen('org/repo', 42)).toBe(false)
  })

  it('returns false when any check is failing', async () => {
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'BugBot', conclusion: 'success', lastRunAt: new Date() })
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'CI', conclusion: 'failure', lastRunAt: new Date() })
    const { isPRGreen } = await import('../../agents/index.js')
    expect(await isPRGreen('org/repo', 42)).toBe(false)
  })

  it('returns false when all checks pass but unreviewed scanner events remain', async () => {
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'BugBot', conclusion: 'success', lastRunAt: new Date() })
    queries.insertEvent({
      id: 'open-evt', repo: 'org/repo', prNumber: 42, prTitle: 'x', prUrl: 'x',
      prAuthor: 'a', eventType: 'comment', source: 'bugbot',
      actor: 'bugbot[bot]', body: 'open issue', githubUrl: 'x', receivedAt: new Date(),
    })
    const { isPRGreen } = await import('../../agents/index.js')
    expect(await isPRGreen('org/repo', 42)).toBe(false)
  })

  it('returns true when all checks pass and no open scanner events', async () => {
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'BugBot', conclusion: 'success', lastRunAt: new Date() })
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'CI', conclusion: 'success', lastRunAt: new Date() })
    const { isPRGreen } = await import('../../agents/index.js')
    expect(await isPRGreen('org/repo', 42)).toBe(true)
  })
})

describe('handlePRGreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initDB(':memory:')
  })
  afterEach(() => closeDB())

  it('posts a completion comment on the PR', async () => {
    const { postPRComment } = await import('../../github/client.js')
    vi.mocked(postPRComment).mockResolvedValue(undefined)
    const { handlePRGreen } = await import('../../agents/index.js')
    await handlePRGreen('org/repo', 42, 'https://...')
    expect(postPRComment).toHaveBeenCalledOnce()
    const commentArg = vi.mocked(postPRComment).mock.calls[0][2] as unknown as string
    // commentArg is prNumber (42), body is arg index 3
    const bodyArg = vi.mocked(postPRComment).mock.calls[0][3] as string
    expect(bodyArg).toContain('\u2705')
    expect(bodyArg).toContain('All checks passing')
  })

  it('fires a macOS notification', async () => {
    const notifier = (await import('node-notifier')).default
    const { postPRComment } = await import('../../github/client.js')
    vi.mocked(postPRComment).mockResolvedValue(undefined)
    const { handlePRGreen } = await import('../../agents/index.js')
    await handlePRGreen('org/repo', 42, 'https://...')
    expect(notifier.notify).toHaveBeenCalledOnce()
    const notifArg = vi.mocked(notifier.notify).mock.calls[0][0] as Record<string, unknown>
    expect(notifArg.title).toContain('\u2705')
  })
})

describe('green state via handleScannerCheckCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initDB(':memory:')
  })
  afterEach(() => closeDB())

  it('triggers handlePRGreen when all checks pass', async () => {
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'BugBot', conclusion: 'success', lastRunAt: new Date() })
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'CI', conclusion: 'success', lastRunAt: new Date() })

    const { postPRComment } = await import('../../github/client.js')
    vi.mocked(postPRComment).mockResolvedValue(undefined)
    const notifier = (await import('node-notifier')).default

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    await handleScannerCheckCompleted({
      repo: 'org/repo', prNumber: 42, checkRunId: 99,
      checkName: 'BugBot', conclusion: 'success',
      startedAt: new Date(), completedAt: new Date(),
      scannerLogin: 'bugbot[bot]',
    })

    expect(postPRComment).toHaveBeenCalledOnce()
    const bodyArg = vi.mocked(postPRComment).mock.calls[0][3] as string
    expect(bodyArg).toContain('\u2705')
    expect(notifier.notify).toHaveBeenCalledOnce()
  })

  it('does not call handlePRGreen when a check is still failing', async () => {
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'BugBot', conclusion: 'success', lastRunAt: new Date() })
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'CI', conclusion: 'failure', lastRunAt: new Date() })

    const { postPRComment } = await import('../../github/client.js')
    vi.mocked(postPRComment).mockResolvedValue(undefined)

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    await handleScannerCheckCompleted({
      repo: 'org/repo', prNumber: 42, checkRunId: 100,
      checkName: 'BugBot', conclusion: 'success',
      startedAt: new Date(), completedAt: new Date(),
      scannerLogin: 'bugbot[bot]',
    })

    expect(postPRComment).not.toHaveBeenCalled()
  })

  it('unlinks the session after green state is reached', async () => {
    queries.upsertPRHealth({ repo: 'org/repo', prNumber: 42, checkName: 'BugBot', conclusion: 'success', lastRunAt: new Date() })
    queries.insertLinkedSession({
      id: 'sess-green', repo: 'org/repo', prNumber: 42,
      agentType: 'claude-code', terminalPid: 11111,
      tmuxPane: null, repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })

    const { postPRComment, deletePRComment } = await import('../../github/client.js')
    vi.mocked(postPRComment).mockResolvedValue(undefined)
    vi.mocked(deletePRComment).mockResolvedValue(undefined)

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    await handleScannerCheckCompleted({
      repo: 'org/repo', prNumber: 42, checkRunId: 101,
      checkName: 'BugBot', conclusion: 'success',
      startedAt: new Date(), completedAt: new Date(),
      scannerLogin: 'bugbot[bot]',
    })

    const session = queries.getLinkedSession('org/repo', 42)
    expect(session?.unlinked_at).not.toBeNull()
    expect(session?.unlink_reason).toBe('pr_closed')
  })
})
