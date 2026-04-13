import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initDB, closeDB } from '../../db/index.js'
import * as queries from '../../db/queries.js'

vi.mock('../../github/client.js', () => ({
  fetchScannerComments: vi.fn().mockResolvedValue([]),
  getPRMeta: vi.fn().mockResolvedValue({ prTitle: 'Fix', prUrl: 'https://...' }),
  postPRComment: vi.fn().mockResolvedValue({ id: 999 }),
  deletePRComment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../agents/inject.js', () => ({ injectIntoSession: vi.fn() }))
vi.mock('../../agents/claude-code.js', () => ({ dispatchToClaudeCode: vi.fn() }))

describe('unlinkSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initDB(':memory:')
  })
  afterEach(() => closeDB())

  it('sets unlinked_at and unlink_reason on the session', async () => {
    queries.insertLinkedSession({
      id: 'sess-1', repo: 'org/repo', prNumber: 42,
      agentType: 'claude-code', terminalPid: 12345,
      tmuxPane: null, repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })
    const { unlinkSession } = await import('../../agents/index.js')
    await unlinkSession('org/repo', 42, 'pr_closed')
    const session = queries.getLinkedSession('org/repo', 42)
    expect(session?.unlinked_at).not.toBeNull()
    expect(session?.unlink_reason).toBe('pr_closed')
  })

  it('calls deletePRComment when sentinel_comment_id is set', async () => {
    queries.insertLinkedSession({
      id: 'sess-2', repo: 'org/repo', prNumber: 43,
      agentType: 'claude-code', terminalPid: 12345,
      tmuxPane: null, repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })
    queries.updateLinkedSessionCommentId('sess-2', 555)
    const { deletePRComment } = await import('../../github/client.js')
    const { unlinkSession } = await import('../../agents/index.js')
    await unlinkSession('org/repo', 43, 'manual')
    expect(deletePRComment).toHaveBeenCalledWith('org', 'repo', 555, expect.anything())
  })

  it('does not throw if sentinel_comment_id is null', async () => {
    queries.insertLinkedSession({
      id: 'sess-3', repo: 'org/repo', prNumber: 44,
      agentType: 'claude-code', terminalPid: 12345,
      tmuxPane: null, repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })
    const { unlinkSession } = await import('../../agents/index.js')
    await expect(unlinkSession('org/repo', 44, 'process_exit')).resolves.not.toThrow()
  })

  it('is a no-op if no session exists', async () => {
    const { unlinkSession } = await import('../../agents/index.js')
    await expect(unlinkSession('org/nonexistent', 999, 'manual')).resolves.not.toThrow()
  })
})
