import { Router, raw } from 'express'
import crypto from 'crypto'
import {
  classifyCheckAsScannerBot,
  normalizeScannerComment,
  type GitHubComment,
  type PRMeta,
  type SentinelEvent,
  type EventBatch,
} from '../github/events.js'
import {
  handleScannerCheckCompleted,
  handleCIFailure,
  unlinkSession,
} from '../agents/index.js'
import * as queries from '../db/queries.js'
import { injectIntoSession } from '../agents/inject.js'
import { sendBatchNotification } from '../notifications/index.js'

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

  const action = (payload as { action?: string }).action ?? '-'
  console.log(`[webhook] ${event} (${action})`)

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
  } else if (event === 'pull_request_review_comment') {
    await handleReviewComment(payload)
  } else if (event === 'issue_comment') {
    await handleIssueComment(payload)
  } else if (event === 'pull_request_review') {
    await handlePullRequestReview(payload)
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

interface ReviewCommentPayload {
  action: string
  comment: GitHubComment
  pull_request: {
    number: number
    title: string
    html_url: string
    user: { login: string } | null
  }
  repository: { full_name: string }
}

async function handleReviewComment(payload: Record<string, unknown>): Promise<void> {
  const p = payload as unknown as ReviewCommentPayload
  if (p.action !== 'created') return
  const actor = p.comment.user?.login
  if (!actor || !isScannerBot(actor)) return

  const event = normalizeScannerComment(p.comment, p.repository.full_name, p.pull_request.number, {
    prTitle: p.pull_request.title,
    prUrl: p.pull_request.html_url,
    prAuthor: p.pull_request.user?.login ?? '',
  })
  await recordAndDispatch(event, p.repository.full_name, p.pull_request.number, event.prTitle, event.prUrl)
}

interface IssueCommentPayload {
  action: string
  comment: GitHubComment
  issue: {
    number: number
    title: string
    html_url: string
    pull_request?: unknown
    user: { login: string } | null
  }
  repository: { full_name: string }
}

async function handleIssueComment(payload: Record<string, unknown>): Promise<void> {
  const p = payload as unknown as IssueCommentPayload
  if (p.action !== 'created') return
  if (!p.issue.pull_request) return // only care about comments on PRs
  const actor = p.comment.user?.login
  if (!actor || !isScannerBot(actor)) return

  const event = normalizeScannerComment(p.comment, p.repository.full_name, p.issue.number, {
    prTitle: p.issue.title,
    prUrl: p.issue.html_url,
    prAuthor: p.issue.user?.login ?? '',
  })
  await recordAndDispatch(event, p.repository.full_name, p.issue.number, event.prTitle, event.prUrl)
}

interface PullRequestReviewPayload {
  action: string
  review: {
    id: number
    user: { login: string } | null
    body: string | null
    html_url: string
    submitted_at: string
  }
  pull_request: {
    number: number
    title: string
    html_url: string
    user: { login: string } | null
  }
  repository: { full_name: string }
}

async function handlePullRequestReview(payload: Record<string, unknown>): Promise<void> {
  const p = payload as unknown as PullRequestReviewPayload
  if (p.action !== 'submitted') return
  const actor = p.review.user?.login
  if (!actor || !isScannerBot(actor)) return
  if (!p.review.body) return

  const comment: GitHubComment = {
    id: p.review.id,
    user: { login: actor, type: 'Bot' },
    body: p.review.body,
    html_url: p.review.html_url,
    created_at: p.review.submitted_at,
  }
  const event = normalizeScannerComment(comment, p.repository.full_name, p.pull_request.number, {
    prTitle: p.pull_request.title,
    prUrl: p.pull_request.html_url,
    prAuthor: p.pull_request.user?.login ?? '',
  })
  await recordAndDispatch(event, p.repository.full_name, p.pull_request.number, event.prTitle, event.prUrl)
}

function isScannerBot(login: string): boolean {
  const configured = (process.env.SCANNER_BOT_LOGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return configured.includes(login)
}

async function recordAndDispatch(
  event: SentinelEvent,
  repo: string,
  prNumber: number,
  prTitle: string,
  prUrl: string
): Promise<void> {
  queries.insertEvent(event)
  const batch: EventBatch = { repo, prNumber, events: [event] }
  const prMeta: PRMeta = { prTitle, prUrl }
  const linked = queries.getLinkedSession(repo, prNumber)
  if (linked && !linked.unlinked_at) {
    await injectIntoSession(linked, batch, prMeta)
  } else {
    await sendBatchNotification(batch, prMeta)
  }
}
