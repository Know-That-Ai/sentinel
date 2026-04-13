import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PRMeta } from '../../github/events.js'

vi.mock('../../agents/claude-code.js', () => ({ dispatchToClaudeCode: vi.fn() }))
vi.mock('../../agents/openclaw.js', () => ({ dispatchToOpenClaw: vi.fn(), isOpenClawRunning: vi.fn() }))

describe('dispatch routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.OPENCLAW_GITHUB_LOGINS = 'rose-agent'
  })

  const prMeta: PRMeta = { prTitle: 'x', prUrl: 'x' }

  it('routes to claude-code by default', async () => {
    process.env.PREFERRED_AGENT = 'claude-code'
    const { dispatchBatch } = await import('../../agents/index.js')
    const { dispatchToClaudeCode } = await import('../../agents/claude-code.js')
    vi.mocked(dispatchToClaudeCode).mockResolvedValue(undefined)

    await dispatchBatch(
      { repo: 'org/repo', prNumber: 42, events: [{ prAuthor: 'human' } as any] },
      prMeta
    )
    expect(dispatchToClaudeCode).toHaveBeenCalledOnce()
  })

  it('routes to openclaw when preferred, PR author matches, and server is up', async () => {
    process.env.PREFERRED_AGENT = 'openclaw'
    const { isOpenClawRunning, dispatchToOpenClaw } = await import('../../agents/openclaw.js')
    vi.mocked(isOpenClawRunning).mockResolvedValue(true)
    vi.mocked(dispatchToOpenClaw).mockResolvedValue(undefined)

    const { dispatchBatch } = await import('../../agents/index.js')
    await dispatchBatch(
      { repo: 'org/repo', prNumber: 42, events: [{ prAuthor: 'rose-agent' } as any] },
      prMeta
    )
    expect(dispatchToOpenClaw).toHaveBeenCalledOnce()
  })

  it('falls back to claude-code when openclaw is unreachable', async () => {
    process.env.PREFERRED_AGENT = 'openclaw'
    const { isOpenClawRunning } = await import('../../agents/openclaw.js')
    const { dispatchToClaudeCode } = await import('../../agents/claude-code.js')
    vi.mocked(isOpenClawRunning).mockResolvedValue(false)
    vi.mocked(dispatchToClaudeCode).mockResolvedValue(undefined)

    const { dispatchBatch } = await import('../../agents/index.js')
    await dispatchBatch(
      { repo: 'org/repo', prNumber: 42, events: [{ prAuthor: 'rose-agent' } as any] },
      prMeta
    )
    expect(dispatchToClaudeCode).toHaveBeenCalledOnce()
  })

  it('falls back to claude-code when PR author is not an openclaw agent', async () => {
    process.env.PREFERRED_AGENT = 'openclaw'
    const { isOpenClawRunning } = await import('../../agents/openclaw.js')
    const { dispatchToClaudeCode } = await import('../../agents/claude-code.js')
    vi.mocked(isOpenClawRunning).mockResolvedValue(true)
    vi.mocked(dispatchToClaudeCode).mockResolvedValue(undefined)

    const { dispatchBatch } = await import('../../agents/index.js')
    await dispatchBatch(
      { repo: 'org/repo', prNumber: 42, events: [{ prAuthor: 'brian' } as any] },
      prMeta
    )
    expect(dispatchToClaudeCode).toHaveBeenCalledOnce()
  })
})
