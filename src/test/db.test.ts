import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDB, closeDB } from '../db/index.js'
import * as queries from '../db/queries.js'
import type { SentinelEvent } from '../github/events.js'

describe('database', () => {
  beforeEach(() => initDB(':memory:'))
  afterEach(() => closeDB())

  it('creates all required tables', () => {
    const tables = queries.getTableNames()
    expect(tables).toContain('events')
    expect(tables).toContain('watched_repos')
    expect(tables).toContain('check_run_triggers')
    expect(tables).toContain('linked_sessions')
    expect(tables).toContain('pr_health')
    expect(tables).toContain('dispatch_log')
  })

  it('inserts and retrieves an event', () => {
    const event: SentinelEvent = {
      id: 'test-id-1',
      repo: 'org/repo',
      prNumber: 42,
      prTitle: 'Fix auth',
      prUrl: 'https://github.com/org/repo/pull/42',
      prAuthor: 'agent-bot',
      eventType: 'comment',
      source: 'bugbot',
      actor: 'bugbot[bot]',
      body: 'Potential null dereference on line 84',
      githubUrl: 'https://github.com/org/repo/pull/42#issuecomment-1',
      receivedAt: new Date(),
    }
    queries.insertEvent(event)
    const retrieved = queries.getEventById('test-id-1')
    expect(retrieved).not.toBeNull()
    expect(retrieved?.repo).toBe('org/repo')
    expect(retrieved?.source).toBe('bugbot')
  })

  it('deduplicates events by id', () => {
    const event: SentinelEvent = {
      id: 'dupe-id',
      repo: 'org/repo',
      prNumber: 42,
      prTitle: 'Fix auth',
      prUrl: 'https://github.com/org/repo/pull/42',
      prAuthor: 'agent-bot',
      eventType: 'comment',
      source: 'bugbot',
      actor: 'bugbot[bot]',
      body: 'Issue found',
      githubUrl: 'https://github.com/org/repo/pull/42#issuecomment-1',
      receivedAt: new Date(),
    }
    queries.insertEvent(event)
    queries.insertEvent(event) // should not throw
    const all = queries.getUnreviewedEvents()
    const dupes = all.filter(e => e.id === 'dupe-id')
    expect(dupes).toHaveLength(1)
  })

  it('upserts pr_health and updates on re-run', () => {
    queries.upsertPRHealth({
      repo: 'org/repo', prNumber: 42,
      checkName: 'BugBot', conclusion: 'failure',
      lastRunAt: new Date(),
    })
    queries.upsertPRHealth({
      repo: 'org/repo', prNumber: 42,
      checkName: 'BugBot', conclusion: 'success',
      lastRunAt: new Date(),
    })
    const checks = queries.getPRHealth('org/repo', 42)
    expect(checks).toHaveLength(1)
    expect(checks[0].last_conclusion).toBe('success')
  })

  it('inserts a linked session and retrieves it', () => {
    queries.insertLinkedSession({
      id: 'session-1',
      repo: 'org/repo',
      prNumber: 42,
      agentType: 'claude-code',
      terminalPid: 12345,
      tmuxPane: null,
      repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })
    const session = queries.getLinkedSession('org/repo', 42)
    expect(session).not.toBeNull()
    expect(session?.terminal_pid).toBe(12345)
  })

  it('unlinks a session and sets reason', () => {
    queries.insertLinkedSession({
      id: 'session-2', repo: 'org/repo', prNumber: 43,
      agentType: 'claude-code', terminalPid: 99999,
      tmuxPane: null, repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })
    queries.unlinkSession('org/repo', 43, 'process_exit')
    const session = queries.getLinkedSession('org/repo', 43)
    expect(session?.unlinked_at).not.toBeNull()
    expect(session?.unlink_reason).toBe('process_exit')
  })

  it('getActiveLinkedSessions returns only sessions without unlinked_at', () => {
    queries.insertLinkedSession({
      id: 'active-1', repo: 'org/repo', prNumber: 10,
      agentType: 'claude-code', terminalPid: 111,
      tmuxPane: null, repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })
    queries.insertLinkedSession({
      id: 'active-2', repo: 'org/repo', prNumber: 11,
      agentType: 'claude-code', terminalPid: 222,
      tmuxPane: null, repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })
    queries.unlinkSession('org/repo', 11, 'manual')
    const active = queries.getActiveLinkedSessions()
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe('active-1')
  })

  it('inserts and retrieves check_run_triggers', () => {
    queries.insertCheckRunTrigger({
      repo: 'org/repo',
      prNumber: 42,
      checkRunId: 100,
      checkName: 'BugBot',
      conclusion: 'action_required',
      startedAt: new Date(),
      completedAt: new Date(),
    })
    const trigger = queries.getCheckRunTrigger('org/repo', 100)
    expect(trigger).not.toBeNull()
    expect(trigger?.check_name).toBe('BugBot')
  })

  it('getUnreviewedScannerEvents returns only unreviewed scanner events for a PR', () => {
    queries.insertEvent({
      id: 'scanner-1', repo: 'org/repo', prNumber: 42,
      prTitle: 'Fix', prUrl: 'x', prAuthor: 'a',
      eventType: 'comment', source: 'bugbot',
      actor: 'bugbot[bot]', body: 'issue', githubUrl: 'x',
      receivedAt: new Date(),
    })
    queries.insertEvent({
      id: 'human-1', repo: 'org/repo', prNumber: 42,
      prTitle: 'Fix', prUrl: 'x', prAuthor: 'a',
      eventType: 'comment', source: 'human',
      actor: 'dev', body: 'LGTM', githubUrl: 'x',
      receivedAt: new Date(),
    })
    const scannerEvents = queries.getUnreviewedScannerEvents('org/repo', 42)
    expect(scannerEvents).toHaveLength(1)
    expect(scannerEvents[0].id).toBe('scanner-1')
  })

  it('updateLinkedSessionCommentId stores the comment ID', () => {
    queries.insertLinkedSession({
      id: 'sess-cid', repo: 'org/repo', prNumber: 50,
      agentType: 'claude-code', terminalPid: 333,
      tmuxPane: null, repoPath: '/tmp/repo',
      linkedAt: new Date().toISOString(),
    })
    queries.updateLinkedSessionCommentId('sess-cid', 777)
    const session = queries.getLinkedSession('org/repo', 50)
    expect(session?.sentinel_comment_id).toBe(777)
  })
})
