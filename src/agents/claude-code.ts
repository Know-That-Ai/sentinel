import { spawn } from 'child_process'
import { buildBatchPrompt } from './prompts.js'
import { resolveRepoPath } from '../config.js'
import type { EventBatch, PRMeta } from '../github/events.js'

export async function dispatchToClaudeCode(batch: EventBatch, prMeta: PRMeta): Promise<void> {
  const repoPath = resolveRepoPath(batch.repo)
  const prompt = buildBatchPrompt(batch, prMeta.prTitle, prMeta.prUrl)

  const proc = spawn('claude', [
    '--print',
    '--dangerously-skip-permissions',
    '-p', prompt,
  ], {
    cwd: repoPath,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Capture output for dispatch log
  let stdout = ''
  let stderr = ''
  proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
  proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })

  proc.on('error', (err) => {
    console.error('Claude Code dispatch error:', err)
  })
}
