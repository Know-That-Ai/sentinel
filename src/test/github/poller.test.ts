import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { initDB, closeDB } from '../../db/index.js'
import * as queries from '../../db/queries.js'

vi.mock('../../agents/index.js', () => ({
  handleScannerCheckCompleted: vi.fn().mockResolvedValue(undefined),
}))

describe('pollOnce', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    initDB(':memory:')
    process.env.SCANNER_BOT_LOGINS = 'bugbot[bot]'
  })
  afterEach(() => closeDB())

  it('calls handleScannerCheckCompleted for a new completed scanner check run', async () => {
    // Seed a watched repo
    queries.insertWatchedRepo('org/repo')

    const mockOctokit = {
      pulls: {
        list: vi.fn().mockResolvedValue({
          data: [{ number: 42, head: { sha: 'abc123' }, title: 'Fix auth', html_url: 'https://...', user: { login: 'dev' } }],
        }),
      },
      checks: {
        listForRef: vi.fn().mockResolvedValue({
          data: {
            check_runs: [{
              id: 100,
              name: 'BugBot Scan',
              conclusion: 'action_required',
              started_at: '2024-01-01T10:00:00Z',
              completed_at: '2024-01-01T10:05:00Z',
              app: { slug: 'bugbot' },
              status: 'completed',
            }],
          },
        }),
      },
    }

    const { pollOnce } = await import('../../github/poller.js')
    await pollOnce(mockOctokit as any)

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    expect(handleScannerCheckCompleted).toHaveBeenCalledOnce()
    expect(handleScannerCheckCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        repo: 'org/repo',
        prNumber: 42,
        checkRunId: 100,
        checkName: 'BugBot Scan',
      })
    )
  })

  it('skips check runs already in check_run_triggers', async () => {
    queries.insertWatchedRepo('org/repo')

    // Pre-insert the check run trigger so the poller should skip it
    queries.insertCheckRunTrigger({
      repo: 'org/repo',
      prNumber: 42,
      checkRunId: 200,
      checkName: 'BugBot Scan',
      conclusion: 'action_required',
      startedAt: new Date('2024-01-01T10:00:00Z'),
      completedAt: new Date('2024-01-01T10:05:00Z'),
    })

    const mockOctokit = {
      pulls: {
        list: vi.fn().mockResolvedValue({
          data: [{ number: 42, head: { sha: 'abc123' }, title: 'Fix auth', html_url: 'https://...', user: { login: 'dev' } }],
        }),
      },
      checks: {
        listForRef: vi.fn().mockResolvedValue({
          data: {
            check_runs: [{
              id: 200,
              name: 'BugBot Scan',
              conclusion: 'action_required',
              started_at: '2024-01-01T10:00:00Z',
              completed_at: '2024-01-01T10:05:00Z',
              app: { slug: 'bugbot' },
              status: 'completed',
            }],
          },
        }),
      },
    }

    const { pollOnce } = await import('../../github/poller.js')
    await pollOnce(mockOctokit as any)

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    expect(handleScannerCheckCompleted).not.toHaveBeenCalled()
  })

  it('updates last_polled on the watched repo', async () => {
    queries.insertWatchedRepo('org/repo')

    const mockOctokit = {
      pulls: { list: vi.fn().mockResolvedValue({ data: [] }) },
      checks: { listForRef: vi.fn().mockResolvedValue({ data: { check_runs: [] } }) },
    }

    const { pollOnce } = await import('../../github/poller.js')
    await pollOnce(mockOctokit as any)

    const repo = queries.getWatchedRepo('org/repo')
    expect(repo?.last_polled).not.toBeNull()
  })

  it('skips non-scanner check runs', async () => {
    queries.insertWatchedRepo('org/repo')

    const mockOctokit = {
      pulls: {
        list: vi.fn().mockResolvedValue({
          data: [{ number: 42, head: { sha: 'abc123' }, title: 'Fix', html_url: 'https://...', user: { login: 'dev' } }],
        }),
      },
      checks: {
        listForRef: vi.fn().mockResolvedValue({
          data: {
            check_runs: [{
              id: 300,
              name: 'run-tests',
              conclusion: 'success',
              started_at: '2024-01-01T10:00:00Z',
              completed_at: '2024-01-01T10:05:00Z',
              app: { slug: 'github-actions' },
              status: 'completed',
            }],
          },
        }),
      },
    }

    const { pollOnce } = await import('../../github/poller.js')
    await pollOnce(mockOctokit as any)

    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    expect(handleScannerCheckCompleted).not.toHaveBeenCalled()
  })
})
