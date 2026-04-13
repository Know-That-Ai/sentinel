import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import crypto from 'crypto'
import { buildTestApp } from '../helpers/app.js'

const WEBHOOK_SECRET = 'test-secret-abc'

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')
}

vi.mock('../../agents/index.js', () => ({
  handleScannerCheckCompleted: vi.fn().mockResolvedValue(undefined),
  handleCIFailure: vi.fn().mockResolvedValue(undefined),
  unlinkSession: vi.fn().mockResolvedValue(undefined),
}))

describe('webhook server', () => {
  let app: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET
    app = buildTestApp()
    vi.clearAllMocks()
  })

  it('returns 200 for valid signature', async () => {
    const body = JSON.stringify({ action: 'completed', check_run: null })
    await request(app)
      .post('/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'check_run')
      .type('json')
      .send(body)
      .expect(200)
  })

  it('returns 401 for invalid signature', async () => {
    const body = JSON.stringify({ action: 'completed' })
    await request(app)
      .post('/webhook')
      .set('x-hub-signature-256', 'sha256=badsignature')
      .set('x-github-event', 'check_run')
      .type('json')
      .send(body)
      .expect(401)
  })

  it('returns 200 for GET /health', async () => {
    await request(app).get('/health').expect(200)
  })

  it('ignores check_run events that are not completed', async () => {
    const { handleScannerCheckCompleted } = await import('../../agents/index.js')
    const body = JSON.stringify({
      action: 'in_progress',
      check_run: { name: 'BugBot', pull_requests: [] },
      repository: { full_name: 'org/repo' },
    })
    await request(app)
      .post('/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'check_run')
      .type('json')
      .send(body)
    expect(handleScannerCheckCompleted).not.toHaveBeenCalled()
  })

  it('routes completed scanner check_run to handleScannerCheckCompleted', async () => {
    const { handleScannerCheckCompleted } = await import('../../agents/index.js')

    process.env.SCANNER_BOT_LOGINS = 'bugbot[bot]'

    const payload = {
      action: 'completed',
      check_run: {
        id: 1, name: 'BugBot Scan',
        conclusion: 'action_required',
        started_at: new Date().toISOString(),
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
    expect(handleScannerCheckCompleted).toHaveBeenCalledOnce()
  })

  it('routes completed failure non-scanner check_run to handleCIFailure', async () => {
    const { handleCIFailure } = await import('../../agents/index.js')

    process.env.SCANNER_BOT_LOGINS = 'bugbot[bot]'

    const payload = {
      action: 'completed',
      check_run: {
        id: 2, name: 'run-tests',
        conclusion: 'failure',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        app: { slug: 'github-actions' },
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
    expect(handleCIFailure).toHaveBeenCalledOnce()
  })

  it('routes pull_request closed to unlinkSession', async () => {
    const { unlinkSession } = await import('../../agents/index.js')

    const payload = {
      action: 'closed',
      pull_request: { number: 42 },
      repository: { full_name: 'org/repo' },
    }
    const body = JSON.stringify(payload)
    await request(app)
      .post('/webhook')
      .set('x-hub-signature-256', sign(body))
      .set('x-github-event', 'pull_request')
      .type('json')
      .send(body)
    expect(unlinkSession).toHaveBeenCalledWith('org/repo', 42, 'pr_closed')
  })
})
