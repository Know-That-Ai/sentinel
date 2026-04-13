import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs/promises'
import { execSync } from 'child_process'
import path from 'path'
import os from 'os'

vi.mock('child_process', async (orig) => ({
  ...(await orig<any>()),
  execSync: vi.fn(),
}))

describe('injectIntoSession', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sentinel-test-'))
    vi.clearAllMocks()
  })

  it('writes the batch prompt to .sentinel/inbox/{prNumber}.md', async () => {
    const { injectIntoSession } = await import('../../agents/inject.js')
    const session = {
      id: 's1', repo: 'org/repo', pr_number: 42,
      agent_type: 'claude-code', terminal_pid: 999,
      tmux_pane: null, repo_path: tmpDir,
      linked_at: new Date().toISOString(),
      unlinked_at: null, unlink_reason: null, sentinel_comment_id: null,
    }
    const batch = { repo: 'org/repo', prNumber: 42, events: [] }
    const prMeta = { prTitle: 'Fix', prUrl: 'https://...' }
    const prompt = 'Test prompt content'

    await injectIntoSession(session, batch, prMeta, prompt)

    const inboxFile = path.join(tmpDir, '.sentinel', 'inbox', '42.md')
    const content = await fs.readFile(inboxFile, 'utf-8')
    expect(content).toBe(prompt)
  })

  it('adds .sentinel/ to .gitignore if not already present', async () => {
    const { injectIntoSession } = await import('../../agents/inject.js')
    const session = {
      id: 's1', repo: 'org/repo', pr_number: 42,
      agent_type: 'claude-code', terminal_pid: 999,
      tmux_pane: null, repo_path: tmpDir,
      linked_at: new Date().toISOString(),
      unlinked_at: null, unlink_reason: null, sentinel_comment_id: null,
    }
    await injectIntoSession(session, { repo: 'org/repo', prNumber: 42, events: [] }, { prTitle: 'x', prUrl: 'x' }, 'prompt')
    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf-8')
    expect(gitignore).toContain('.sentinel/')
  })

  it('uses tmux send-keys when tmux_pane is set', async () => {
    const { injectIntoSession } = await import('../../agents/inject.js')
    const session = {
      id: 's1', repo: 'org/repo', pr_number: 42,
      agent_type: 'claude-code', terminal_pid: 999,
      tmux_pane: 'sentinel:0.1', repo_path: tmpDir,
      linked_at: new Date().toISOString(),
      unlinked_at: null, unlink_reason: null, sentinel_comment_id: null,
    }
    await injectIntoSession(session, { repo: 'org/repo', prNumber: 42, events: [] }, { prTitle: 'x', prUrl: 'x' }, 'hello')
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('tmux send-keys'),
      expect.anything()
    )
  })

  it('does not duplicate .sentinel/ in .gitignore', async () => {
    // Write .gitignore with .sentinel/ already present
    await fs.writeFile(path.join(tmpDir, '.gitignore'), '.sentinel/\n', 'utf-8')

    const { injectIntoSession } = await import('../../agents/inject.js')
    const session = {
      id: 's1', repo: 'org/repo', pr_number: 42,
      agent_type: 'claude-code', terminal_pid: 999,
      tmux_pane: null, repo_path: tmpDir,
      linked_at: new Date().toISOString(),
      unlinked_at: null, unlink_reason: null, sentinel_comment_id: null,
    }
    await injectIntoSession(session, { repo: 'org/repo', prNumber: 42, events: [] }, { prTitle: 'x', prUrl: 'x' }, 'prompt')
    const gitignore = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf-8')
    const occurrences = gitignore.split('.sentinel/').length - 1
    expect(occurrences).toBe(1)
  })
})
