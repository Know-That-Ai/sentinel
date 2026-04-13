import { describe, it, expect } from 'vitest'
import { classifyCheckAsScannerBot, normalizeScannerComment } from '../../github/events.js'

describe('classifyCheckAsScannerBot', () => {
  const scannerLogins = ['bugbot[bot]', 'github-advanced-security[bot]']

  it('matches bugbot by check name', () => {
    expect(classifyCheckAsScannerBot('BugBot Scan', undefined, scannerLogins))
      .toBe('bugbot[bot]')
  })

  it('matches codeql by check name', () => {
    expect(classifyCheckAsScannerBot('CodeQL', undefined, scannerLogins))
      .toBe('github-advanced-security[bot]')
  })

  it('matches by app slug when provided', () => {
    expect(classifyCheckAsScannerBot('some-check', 'bugbot', scannerLogins))
      .toBe('bugbot[bot]')
  })

  it('returns null for a regular CI check', () => {
    expect(classifyCheckAsScannerBot('run-tests', 'github-actions', scannerLogins))
      .toBeNull()
  })

  it('returns null for lint check', () => {
    expect(classifyCheckAsScannerBot('ESLint', undefined, scannerLogins))
      .toBeNull()
  })
})

describe('normalizeScannerComment', () => {
  it('produces a valid SentinelEvent from a GitHub comment', () => {
    const comment = {
      id: 100,
      user: { login: 'bugbot[bot]', type: 'Bot' },
      body: 'Potential null dereference at line 84',
      html_url: 'https://github.com/org/repo/pull/42#issuecomment-100',
      created_at: new Date().toISOString(),
    }
    const event = normalizeScannerComment(comment as any, 'org/repo', 42, {
      prTitle: 'Fix auth',
      prUrl: 'https://github.com/org/repo/pull/42',
      prAuthor: 'agent-bot',
    })
    expect(event.source).toBe('bugbot')
    expect(event.eventType).toBe('comment')
    expect(event.prNumber).toBe(42)
    expect(event.body).toContain('null dereference')
    expect(event.id).toBeTruthy()
  })

  it('truncates body to 500 chars', () => {
    const longBody = 'x'.repeat(600)
    const comment = {
      id: 101,
      user: { login: 'bugbot[bot]', type: 'Bot' },
      body: longBody,
      html_url: 'https://github.com/org/repo/pull/42#issuecomment-101',
      created_at: new Date().toISOString(),
    }
    const event = normalizeScannerComment(comment as any, 'org/repo', 42, {
      prTitle: 'Fix', prUrl: 'https://...', prAuthor: 'a',
    })
    expect(event.body!.length).toBeLessThanOrEqual(500)
  })
})
