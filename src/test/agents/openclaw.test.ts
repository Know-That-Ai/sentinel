import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PRMeta } from '../../github/events.js'

const originalFetch = globalThis.fetch
globalThis.fetch = vi.fn()

describe('dispatchToOpenClaw', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENCLAW_URL = 'http://localhost:4000'
    process.env.OPENCLAW_API_KEY = 'test-key'
    process.env.OPENCLAW_GITHUB_LOGINS = 'rose-agent,openclaw-bot'
  })

  it('POSTs a raw prompt string to OpenClaw /tasks', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as any)
    const { dispatchToOpenClaw } = await import('../../agents/openclaw.js')

    const batch = {
      repo: 'org/repo', prNumber: 42,
      events: [{
        id: 'e1', repo: 'org/repo', prNumber: 42, prTitle: 'Fix',
        prUrl: 'https://...', prAuthor: 'rose-agent',
        eventType: 'comment' as const, source: 'bugbot' as const,
        actor: 'bugbot[bot]', body: 'Issue', githubUrl: 'https://...', receivedAt: new Date(),
      }],
    }
    const prMeta: PRMeta = { prTitle: 'Fix', prUrl: 'https://...' }
    await dispatchToOpenClaw(batch, prMeta)

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/tasks',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)
    expect(typeof body.task).toBe('string')
    expect(body.task.length).toBeGreaterThan(50)
  })

  it('throws when OpenClaw returns non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as any)
    const { dispatchToOpenClaw } = await import('../../agents/openclaw.js')
    const batch = { repo: 'org/repo', prNumber: 42, events: [] }
    const prMeta: PRMeta = { prTitle: 'x', prUrl: 'x' }
    await expect(dispatchToOpenClaw(batch, prMeta))
      .rejects.toThrow('503')
  })
})

describe('isOpenClawRunning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENCLAW_URL = 'http://localhost:4000'
  })

  it('returns true when health check succeeds', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as any)
    const { isOpenClawRunning } = await import('../../agents/openclaw.js')
    expect(await isOpenClawRunning()).toBe(true)
  })

  it('returns false when health check fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'))
    const { isOpenClawRunning } = await import('../../agents/openclaw.js')
    expect(await isOpenClawRunning()).toBe(false)
  })
})
