import { describe, it, expect, vi, beforeEach } from 'vitest'
import notifier from 'node-notifier'

describe('notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('fires a notification for a new event', async () => {
    const { sendBatchNotification, resetNotified } = await import('../notifications/index.js')
    resetNotified()
    await sendBatchNotification({
      repo: 'org/repo',
      prNumber: 42,
      events: [{
        id: 'evt-1', repo: 'org/repo', prNumber: 42,
        prTitle: 'Fix auth', prUrl: 'https://github.com/org/repo/pull/42',
        prAuthor: 'agent', eventType: 'comment', source: 'bugbot',
        actor: 'bugbot[bot]', body: 'Issue found', githubUrl: 'https://github.com/...',
        receivedAt: new Date(),
      }],
    }, { prTitle: 'Fix auth', prUrl: 'https://github.com/org/repo/pull/42' })
    expect(notifier.notify).toHaveBeenCalledOnce()
  })

  it('does not fire duplicate notifications for the same event id', async () => {
    const { sendBatchNotification, resetNotified } = await import('../notifications/index.js')
    resetNotified()
    const batch = {
      repo: 'org/repo', prNumber: 42,
      events: [{ id: 'evt-dupe', repo: 'org/repo', prNumber: 42,
        prTitle: 'Fix', prUrl: 'https://...', prAuthor: 'agent',
        eventType: 'comment' as const, source: 'bugbot' as const,
        actor: 'bugbot[bot]', body: 'dup', githubUrl: 'https://...',
        receivedAt: new Date() }],
    }
    const meta = { prTitle: 'Fix', prUrl: 'https://...' }
    await sendBatchNotification(batch, meta)
    await sendBatchNotification(batch, meta)
    expect(notifier.notify).toHaveBeenCalledOnce()
  })
})
