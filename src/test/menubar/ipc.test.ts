import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDB, closeDB } from '../../db/index.js'
import * as queries from '../../db/queries.js'
import { handleGetUnreviewed, handleMarkReviewed, handleGetLinkedSessions, handleDispatchEvent } from '../../menubar/ipc.js'

describe('IPC handlers', () => {
  beforeEach(() => {
    initDB(':memory:')
  })
  afterEach(() => closeDB())

  it('getUnreviewed returns only unreviewed events', async () => {
    queries.insertEvent({
      id: 'e1', repo: 'org/repo', prNumber: 42, prTitle: 'Fix',
      prUrl: 'https://github.com/org/repo/pull/42', prAuthor: 'a',
      eventType: 'comment', source: 'bugbot',
      actor: 'bugbot[bot]', body: 'issue', githubUrl: 'https://github.com/org/repo/pull/42#issuecomment-1',
      receivedAt: new Date(),
    })
    // Insert a second event and mark it reviewed
    queries.insertEvent({
      id: 'e2', repo: 'org/repo', prNumber: 43, prTitle: 'Other',
      prUrl: 'https://github.com/org/repo/pull/43', prAuthor: 'b',
      eventType: 'comment', source: 'codeql',
      actor: 'codeql[bot]', body: 'alert', githubUrl: 'https://github.com/org/repo/pull/43#issuecomment-2',
      receivedAt: new Date(),
    })
    queries.markEventReviewed('e2')

    const result = await handleGetUnreviewed()
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('e1')
  })

  it('getUnreviewed returns empty array when no events exist', async () => {
    const result = await handleGetUnreviewed()
    expect(result).toHaveLength(0)
  })

  it('markReviewed sets reviewed flag', async () => {
    queries.insertEvent({
      id: 'e2', repo: 'org/repo', prNumber: 42, prTitle: 'Fix',
      prUrl: 'x', prAuthor: 'a', eventType: 'comment', source: 'bugbot',
      actor: 'bugbot[bot]', body: 'issue', githubUrl: 'x', receivedAt: new Date(),
    })
    await handleMarkReviewed('e2')
    const event = queries.getEventById('e2')
    expect(event?.reviewed).toBe(1)
  })

  it('getLinkedSessions returns active sessions only', async () => {
    queries.insertLinkedSession({
      id: 's1', repo: 'org/repo', prNumber: 42, agentType: 'claude-code',
      terminalPid: 123, tmuxPane: null, repoPath: '/tmp',
      linkedAt: new Date().toISOString(),
    })
    // Insert and unlink a second session
    queries.insertLinkedSession({
      id: 's2', repo: 'org/repo2', prNumber: 10, agentType: 'claude-code',
      terminalPid: 456, tmuxPane: null, repoPath: '/tmp2',
      linkedAt: new Date().toISOString(),
    })
    queries.unlinkSession('org/repo2', 10, 'manual')

    const sessions = await handleGetLinkedSessions()
    expect(sessions.some(s => s.id === 's1')).toBe(true)
    expect(sessions.some(s => s.id === 's2')).toBe(false)
  })

  it('dispatchEvent is a stub that resolves without throwing', async () => {
    await expect(handleDispatchEvent('some-event-id')).resolves.not.toThrow()
  })
})
