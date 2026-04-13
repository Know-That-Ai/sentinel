import { buildBatchPrompt } from './prompts.js'
import type { EventBatch, PRMeta } from '../github/events.js'

export async function isOpenClawRunning(): Promise<boolean> {
  const url = process.env.OPENCLAW_URL ?? 'http://localhost:4000'
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

export async function dispatchToOpenClaw(batch: EventBatch, prMeta: PRMeta): Promise<void> {
  const url = process.env.OPENCLAW_URL ?? 'http://localhost:4000'
  const apiKey = process.env.OPENCLAW_API_KEY ?? ''
  const prompt = buildBatchPrompt(batch, prMeta.prTitle, prMeta.prUrl)

  const payload = {
    task: prompt,
    context: {
      repo: batch.repo,
      pr_number: batch.prNumber,
      event_type: batch.events[0]?.eventType ?? 'comment',
      source: batch.events[0]?.source ?? 'other',
    },
    priority: batch.events.some(e => e.source === 'bugbot' || e.eventType === 'check_failure')
      ? 'high' : 'normal',
  }

  const res = await fetch(`${url}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) throw new Error(`OpenClaw dispatch failed: ${res.status}`)
}
