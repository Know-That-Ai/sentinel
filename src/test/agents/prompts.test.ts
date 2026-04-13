import { describe, it, expect } from 'vitest'
import { buildBatchPrompt, PUSH_RULES } from '../../agents/prompts.js'
import type { EventBatch } from '../../agents/index.js'

const makeEvent = (i: number, source = 'bugbot') => ({
  id: `evt-${i}`, repo: 'org/repo', prNumber: 42,
  prTitle: 'Fix auth', prUrl: 'https://github.com/org/repo/pull/42',
  prAuthor: 'agent', eventType: 'comment' as const, source: source as any,
  actor: 'bugbot[bot]', body: `Issue ${i} description`,
  githubUrl: 'https://...', receivedAt: new Date(),
})

describe('buildBatchPrompt', () => {
  it('includes all issues from the batch', () => {
    const batch: EventBatch = {
      repo: 'org/repo', prNumber: 42,
      events: [makeEvent(1), makeEvent(2), makeEvent(3)],
    }
    const prompt = buildBatchPrompt(batch, 'Fix auth', 'https://github.com/org/repo/pull/42')
    expect(prompt).toContain('Issue 1 description')
    expect(prompt).toContain('Issue 2 description')
    expect(prompt).toContain('Issue 3 description')
  })

  it('always contains PUSH_RULES', () => {
    const batch: EventBatch = { repo: 'org/repo', prNumber: 42, events: [makeEvent(1)] }
    const prompt = buildBatchPrompt(batch, 'Fix auth', 'https://...')
    expect(prompt).toContain(PUSH_RULES)
  })

  it('explicitly prohibits --no-verify', () => {
    const batch: EventBatch = { repo: 'org/repo', prNumber: 42, events: [makeEvent(1)] }
    const prompt = buildBatchPrompt(batch, 'Fix auth', 'https://...')
    expect(prompt).toContain('--no-verify')
    expect(prompt.toLowerCase()).toMatch(/do not use.*--no-verify/)
  })

  it('mentions the PR number and repo', () => {
    const batch: EventBatch = { repo: 'org/repo', prNumber: 42, events: [makeEvent(1)] }
    const prompt = buildBatchPrompt(batch, 'Fix auth', 'https://...')
    expect(prompt).toContain('#42')
    expect(prompt).toContain('org/repo')
  })
})

describe('PUSH_RULES', () => {
  it('is a non-empty string', () => {
    expect(typeof PUSH_RULES).toBe('string')
    expect(PUSH_RULES.length).toBeGreaterThan(50)
  })
})
