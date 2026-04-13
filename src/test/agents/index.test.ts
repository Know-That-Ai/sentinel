import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initDB, closeDB } from '../../db/index.js'

vi.mock('../../github/client.js', () => ({
  fetchScannerComments: vi.fn(),
  getPRMeta: vi.fn().mockResolvedValue({ prTitle: 'Fix auth', prUrl: 'https://...' }),
  postPRComment: vi.fn().mockResolvedValue(undefined),
  deletePRComment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../notifications/index.js', () => ({
  sendBatchNotification: vi.fn(),
  labelForSource: vi.fn().mockReturnValue('BugBot'),
}))
vi.mock('../../agents/claude-code.js', () => ({ dispatchToClaudeCode: vi.fn() }))
vi.mock('../../agents/inject.js', () => ({ injectIntoSession: vi.fn() }))

describe('handleScannerCheckCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initDB(':memory:')
  })
  afterEach(() => closeDB())

  it('inserts a check_run_trigger record', async () => {
    const { fetchScannerComments } = await import('../../github/client.js')
    vi.mocked(fetchScannerComments).mockResolvedValue([])

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    await handleScannerCheckCompleted({
      repo: 'org/repo', prNumber: 42, checkRunId: 1,
      checkName: 'BugBot', conclusion: 'action_required',
      startedAt: new Date(), completedAt: new Date(),
      scannerLogin: 'bugbot[bot]',
    })

    const { getCheckRunTrigger } = await import('../../db/queries.js')
    const trigger = getCheckRunTrigger('org/repo', 1)
    expect(trigger).not.toBeNull()
  })

  it('does not dispatch when conclusion is success and PR is not green', async () => {
    const { fetchScannerComments } = await import('../../github/client.js')
    vi.mocked(fetchScannerComments).mockResolvedValue([])
    const { dispatchToClaudeCode } = await import('../../agents/claude-code.js')

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    await handleScannerCheckCompleted({
      repo: 'org/repo', prNumber: 42, checkRunId: 2,
      checkName: 'BugBot', conclusion: 'success',
      startedAt: new Date(), completedAt: new Date(),
      scannerLogin: 'bugbot[bot]',
    })
    expect(dispatchToClaudeCode).not.toHaveBeenCalled()
  })

  it('dispatches when conclusion is failure and events exist', async () => {
    const { fetchScannerComments } = await import('../../github/client.js')
    const mockEvent = {
      id: 'e1', repo: 'org/repo', prNumber: 42, prTitle: 'x',
      prUrl: 'x', prAuthor: 'a', eventType: 'comment' as const,
      source: 'bugbot' as const, actor: 'bugbot[bot]',
      body: 'Issue', githubUrl: 'x', receivedAt: new Date(),
    }
    vi.mocked(fetchScannerComments).mockResolvedValue([mockEvent])

    // Enable auto-dispatch for bugbot
    process.env.AUTO_DISPATCH_BUGBOT = 'true'

    const { dispatchToClaudeCode } = await import('../../agents/claude-code.js')
    vi.mocked(dispatchToClaudeCode).mockResolvedValue(undefined)

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    await handleScannerCheckCompleted({
      repo: 'org/repo', prNumber: 42, checkRunId: 3,
      checkName: 'BugBot', conclusion: 'action_required',
      startedAt: new Date(), completedAt: new Date(),
      scannerLogin: 'bugbot[bot]',
    })
    expect(dispatchToClaudeCode).toHaveBeenCalledOnce()

    // Cleanup
    delete process.env.AUTO_DISPATCH_BUGBOT
  })

  it('sends notification when no linked session and no auto-dispatch', async () => {
    const { fetchScannerComments } = await import('../../github/client.js')
    const mockEvent = {
      id: 'e2', repo: 'org/repo', prNumber: 42, prTitle: 'x',
      prUrl: 'x', prAuthor: 'a', eventType: 'comment' as const,
      source: 'bugbot' as const, actor: 'bugbot[bot]',
      body: 'Issue', githubUrl: 'x', receivedAt: new Date(),
    }
    vi.mocked(fetchScannerComments).mockResolvedValue([mockEvent])

    // Ensure auto-dispatch is off
    delete process.env.AUTO_DISPATCH_BUGBOT

    const { sendBatchNotification } = await import('../../notifications/index.js')

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    await handleScannerCheckCompleted({
      repo: 'org/repo', prNumber: 42, checkRunId: 4,
      checkName: 'BugBot', conclusion: 'action_required',
      startedAt: new Date(), completedAt: new Date(),
      scannerLogin: 'bugbot[bot]',
    })
    expect(sendBatchNotification).toHaveBeenCalledOnce()
  })

  it('injects into linked session when one exists', async () => {
    const { fetchScannerComments } = await import('../../github/client.js')
    const mockEvent = {
      id: 'e3', repo: 'org/repo', prNumber: 42, prTitle: 'x',
      prUrl: 'x', prAuthor: 'a', eventType: 'comment' as const,
      source: 'bugbot' as const, actor: 'bugbot[bot]',
      body: 'Issue', githubUrl: 'x', receivedAt: new Date(),
    }
    vi.mocked(fetchScannerComments).mockResolvedValue([mockEvent])

    // Insert linked session
    const { insertLinkedSession } = await import('../../db/queries.js')
    insertLinkedSession({
      id: 'sess-inject', repo: 'org/repo', prNumber: 42,
      agentType: 'claude-code', terminalPid: 999,
      tmuxPane: null, repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })

    const { injectIntoSession } = await import('../../agents/inject.js')
    vi.mocked(injectIntoSession).mockResolvedValue(undefined)

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    await handleScannerCheckCompleted({
      repo: 'org/repo', prNumber: 42, checkRunId: 5,
      checkName: 'BugBot', conclusion: 'action_required',
      startedAt: new Date(), completedAt: new Date(),
      scannerLogin: 'bugbot[bot]',
    })
    expect(injectIntoSession).toHaveBeenCalledOnce()
  })
})
