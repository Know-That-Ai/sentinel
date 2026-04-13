import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawn } from 'child_process'
import { dispatchToClaudeCode } from '../../agents/claude-code.js'
import type { EventBatch } from '../../agents/index.js'
import type { PRMeta } from '../../github/events.js'

describe('dispatchToClaudeCode', () => {
  beforeEach(() => vi.clearAllMocks())

  const batch: EventBatch = {
    repo: 'org/repo', prNumber: 42,
    events: [{
      id: 'e1', repo: 'org/repo', prNumber: 42, prTitle: 'Fix auth',
      prUrl: 'https://github.com/org/repo/pull/42', prAuthor: 'agent',
      eventType: 'comment', source: 'bugbot', actor: 'bugbot[bot]',
      body: 'Null dereference', githubUrl: 'https://...', receivedAt: new Date(),
    }],
  }
  const prMeta: PRMeta = { prTitle: 'Fix auth', prUrl: 'https://github.com/org/repo/pull/42' }

  it('spawns claude with --print and --dangerously-skip-permissions', async () => {
    const mockProc = { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn() }
    vi.mocked(spawn).mockReturnValue(mockProc as any)

    process.env.REPO_PATHS = JSON.stringify({ 'org/repo': '/tmp/org-repo' })
    await dispatchToClaudeCode(batch, prMeta)

    expect(spawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining(['--print', '--dangerously-skip-permissions']),
      expect.objectContaining({ cwd: '/tmp/org-repo' })
    )
  })

  it('throws if repo has no path mapping in REPO_PATHS', async () => {
    process.env.REPO_PATHS = '{}'
    await expect(dispatchToClaudeCode(batch, prMeta)).rejects.toThrow(/REPO_PATHS|path/)
  })

  it('includes the PR number in the spawned prompt', async () => {
    const mockProc = { stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn() }
    vi.mocked(spawn).mockReturnValue(mockProc as any)
    process.env.REPO_PATHS = JSON.stringify({ 'org/repo': '/tmp/org-repo' })

    await dispatchToClaudeCode(batch, prMeta)

    const callArgs = vi.mocked(spawn).mock.calls[0]
    const args = callArgs[1] as string[]
    const pIndex = args.indexOf('-p')
    const promptArg = args[pIndex + 1]
    expect(promptArg).toContain('#42')
  })
})
