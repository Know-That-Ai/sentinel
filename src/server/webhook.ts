import { Router, raw } from 'express'
import crypto from 'crypto'
import { classifyCheckAsScannerBot } from '../github/events.js'
import { handleScannerCheckCompleted, handleCIFailure, unlinkSession } from '../agents/index.js'

export const webhookRouter = Router()

function verifySignature(payload: Buffer, signature: string | undefined, secret: string): boolean {
  if (!signature) return false
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length) return false
  return crypto.timingSafeEqual(sigBuf, expBuf)
}

webhookRouter.post('/webhook', raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) {
    res.status(500).json({ error: 'WEBHOOK_SECRET not configured' })
    return
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined
  const body = req.body as Buffer

  if (!verifySignature(body, signature, secret)) {
    res.status(401).json({ error: 'Invalid signature' })
    return
  }

  const event = req.headers['x-github-event'] as string
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body.toString())
  } catch {
    res.status(400).json({ error: 'Invalid JSON' })
    return
  }

  try {
    await routeWebhook(event, payload)
  } catch (err) {
    console.error('Webhook handler error:', err)
  }

  res.status(200).json({ received: true })
})

async function routeWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  if (event === 'check_run') {
    await handleCheckRun(payload)
  } else if (event === 'pull_request') {
    await handlePullRequest(payload)
  }
}

interface CheckRunPayload {
  action: string
  check_run: {
    id: number
    name: string
    conclusion: string | null
    started_at: string
    completed_at: string | null
    app?: { slug: string }
    pull_requests: Array<{ number: number }>
  }
  repository: { full_name: string }
}

async function handleCheckRun(payload: Record<string, unknown>): Promise<void> {
  const p = payload as unknown as CheckRunPayload
  if (p.action !== 'completed' || !p.check_run) return

  const checkRun = p.check_run
  const repo = p.repository.full_name
  const prNumber = checkRun.pull_requests?.[0]?.number
  if (!prNumber) return

  const scannerLogins = (process.env.SCANNER_BOT_LOGINS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

  const scannerLogin = classifyCheckAsScannerBot(
    checkRun.name,
    checkRun.app?.slug,
    scannerLogins
  )

  if (scannerLogin) {
    await handleScannerCheckCompleted({
      repo,
      prNumber,
      checkRunId: checkRun.id,
      checkName: checkRun.name,
      conclusion: checkRun.conclusion ?? 'unknown',
      startedAt: new Date(checkRun.started_at),
      completedAt: new Date(checkRun.completed_at ?? new Date().toISOString()),
      scannerLogin,
    })
  } else if (checkRun.conclusion === 'failure') {
    await handleCIFailure({ repo, prNumber, checkRun })
  }
}

interface PullRequestPayload {
  action: string
  pull_request: { number: number }
  repository: { full_name: string }
}

async function handlePullRequest(payload: Record<string, unknown>): Promise<void> {
  const p = payload as unknown as PullRequestPayload
  if (p.action === 'closed' && p.pull_request) {
    await unlinkSession(p.repository.full_name, p.pull_request.number, 'pr_closed')
  }
}
