import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { initDB, closeDB } from '../../db/index.js'
import * as queries from '../../db/queries.js'
import { createApp } from '../../server/index.js'

// Mock only the external boundaries — GitHub API calls and agent spawning
vi.mock('../../github/client.js', () => ({
  fetchScannerComments: vi.fn().mockResolvedValue([
    {
      id: 'smoke-evt-1',
      repo: 'org/repo',
      prNumber: 42,
      prTitle: 'Smoke test PR',
      prUrl: 'https://github.com/org/repo/pull/42',
      prAuthor: 'dev',
      eventType: 'comment',
      source: 'bugbot',
      actor: 'cursor-bugbot[bot]',
      body: 'Potential null dereference at line 42',
      githubUrl: 'https://github.com/org/repo/pull/42#issuecomment-1',
      receivedAt: new Date(),
    },
  ]),
  getPRMeta: vi.fn().mockResolvedValue({ prTitle: 'Smoke test PR', prUrl: 'https://...' }),
  postPRComment: vi.fn().mockResolvedValue(undefined),
  deletePRComment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../agents/claude-code.js', () => ({ dispatchToClaudeCode: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../../agents/inject.js', () => ({ injectIntoSession: vi.fn().mockResolvedValue(undefined) }))

const WEBHOOK_SECRET = 'smoke-test-secret'

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
}

describe('end-to-end smoke test', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.SCANNER_BOT_LOGINS = 'cursor-bugbot[bot]'
    initDB(':memory:')
    app = createApp()
  })

  afterEach(() => closeDB())

  it('webhook → handler → DB: check_run completed writes a check_run_trigger', async () => {
    const payload = {
      action: 'completed',
      check_run: {
        id: 9999,
        name: 'BugBot Scan',
        conclusion: 'action_required',
        started_at: new Date(Date.now() - 60_000).toISOString(),
        completed_at: new Date().toISOString(),
        app: { slug: 'bugbot' },
        pull_requests: [{ number: 42 }],
      },
      repository: { full_name: 'org/repo' },
    }
    const body = JSON.stringify(payload)

    const res = await request(app)
      .post('/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'check_run')
      .type('json')
      .send(body)

    expect(res.status).toBe(200)

    // Verify the check_run_trigger was persisted
    const trigger = queries.getCheckRunTrigger('org/repo', 9999)
    expect(trigger).not.toBeNull()
    expect(trigger?.check_name).toBe('BugBot Scan')
    expect(trigger?.conclusion).toBe('action_required')
    expect(trigger?.pr_number).toBe(42)
  })

  it('webhook → handler → DB: pr_health is upserted on check_run', async () => {
    const payload = {
      action: 'completed',
      check_run: {
        id: 8888,
        name: 'BugBot Scan',
        conclusion: 'action_required',
        started_at: new Date(Date.now() - 60_000).toISOString(),
        completed_at: new Date().toISOString(),
        app: { slug: 'bugbot' },
        pull_requests: [{ number: 42 }],
      },
      repository: { full_name: 'org/repo' },
    }
    const body = JSON.stringify(payload)

    await request(app)
      .post('/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'check_run')
      .type('json')
      .send(body)

    const health = queries.getPRHealth('org/repo', 42)
    expect(health.length).toBeGreaterThan(0)
    expect(health.find(h => h.check_name === 'BugBot Scan')?.last_conclusion).toBe('action_required')
  })

  it('webhook → handler → DB: scanner events are persisted', async () => {
    const payload = {
      action: 'completed',
      check_run: {
        id: 7777,
        name: 'BugBot Scan',
        conclusion: 'action_required',
        started_at: new Date(Date.now() - 60_000).toISOString(),
        completed_at: new Date().toISOString(),
        app: { slug: 'bugbot' },
        pull_requests: [{ number: 42 }],
      },
      repository: { full_name: 'org/repo' },
    }
    const body = JSON.stringify(payload)

    await request(app)
      .post('/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'check_run')
      .type('json')
      .send(body)

    const event = queries.getEventById('smoke-evt-1')
    expect(event).not.toBeNull()
    expect(event?.source).toBe('bugbot')
    expect(event?.pr_number).toBe(42)
  })

  it('rejects webhook with bad signature', async () => {
    const body = JSON.stringify({ action: 'completed' })

    const res = await request(app)
      .post('/webhook')
      .set('x-hub-signature-256', 'sha256=invalid')
      .set('x-github-event', 'check_run')
      .type('json')
      .send(body)

    expect(res.status).toBe(401)
  })
})
