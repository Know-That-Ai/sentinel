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

type Disposition = 'dispatched' | 'notified' | 'dropped' | 'auto_closed'

interface Outcome {
  disposition: Disposition
  reason?: string
  prNumber?: number
  actor?: string
  repo?: string
}

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
  const deliveryId = (req.headers['x-github-delivery'] as string | undefined) ?? null
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(body.toString())
  } catch {
    res.status(400).json({ error: 'Invalid JSON' })
    return
  }

  const action = (payload as { action?: string }).action ?? null
  const repo = (payload as { repository?: { full_name?: string } }).repository?.full_name ?? null

  let outcome: Outcome
  try {
    outcome = await routeWebhook(event, payload)
  } catch (err) {
    console.error('Webhook handler error:', err)
    outcome = { disposition: 'dropped', reason: `handler_error: ${String(err)}` }
  }

  try {
    queries.insertWebhookLog({
      eventType: event,
      action,
      repo: outcome.repo ?? repo,
      prNumber: outcome.prNumber ?? null,
      actor: outcome.actor ?? null,
      disposition: outcome.disposition,
      reason: outcome.reason ?? null,
      deliveryId,
    })
  } catch (err) {
    // Persisting the audit row is best-effort — if it fails (DB locked,
    // disk full, schema drift), we still return 200 so smee doesn't retry,
    // but we surface the failure on stderr so it's not silent.
    console.error(
      `[webhook] insertWebhookLog failed for ${event} (${action ?? '-'}) delivery=${deliveryId ?? '-'}:`,
      err
    )
  }
  console.log(
    `[webhook] ${event} (${action ?? '-'}) → ${outcome.disposition}` +
      (outcome.reason ? ` [${outcome.reason}]` : '')
  )

  res.status(200).json({ received: true })
})

async function routeWebhook(event: string, payload: Record<string, unknown>): Promise<Outcome> {
  switch (event) {
    case 'check_run':
      return handleCheckRun(payload)
    case 'pull_request':
      return handlePullRequest(payload)
    case 'pull_request_review_comment':
      return handleReviewComment(payload)
    case 'issue_comment':
      return handleIssueComment(payload)
    case 'pull_request_review':
      return handlePullRequestReview(payload)
    case 'ping':
      return { disposition: 'dropped', reason: 'ping' }
    default:
      return { disposition: 'dropped', reason: 'unhandled_event_type' }
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

async function handleCheckRun(payload: Record<string, unknown>): Promise<Outcome> {
  const p = payload as unknown as CheckRunPayload
  if (!p.check_run) {
    return { disposition: 'dropped', reason: `action_${p.action}_ignored` }
  }

  const checkRun = p.check_run
  const repo = p.repository.full_name
  const prNumber = checkRun.pull_requests?.[0]?.number

  // Track the in-progress state on created/requested_action too so the UI can
  // show a "scans running" indicator even before the first completion.
  if (p.action === 'created' || p.action === 'rerequested') {
    if (prNumber) {
      queries.upsertPRHealth({
        repo,
        prNumber,
        checkName: checkRun.name,
        conclusion: 'pending',
        lastRunAt: new Date(),
        status: 'in_progress',
      })
    }
    return { disposition: 'dropped', reason: `action_${p.action}_ignored`, repo, prNumber }
  }

  if (p.action !== 'completed') {
    return { disposition: 'dropped', reason: `action_${p.action}_ignored`, repo, prNumber }
  }

  if (!prNumber) {
    return { disposition: 'dropped', reason: 'check_has_no_pr', repo }
  }

  // Mark the check completed in pr_health regardless of scanner status, so the
  // "scans in progress" yellow state clears correctly.
  queries.upsertPRHealth({
    repo,
    prNumber,
    checkName: checkRun.name,
    conclusion: checkRun.conclusion ?? 'unknown',
    lastRunAt: new Date(checkRun.completed_at ?? new Date().toISOString()),
    status: 'completed',
  })

  const scannerLogins = (process.env.SCANNER_BOT_LOGINS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)

  const scannerLogin = classifyCheckAsScannerBot(
    checkRun.name,
    checkRun.app?.slug,
    scannerLogins
  )

  const linked = queries.getLinkedSession(repo, prNumber)
  const isLinked = !!(linked && !linked.unlinked_at)

  if (scannerLogin) {
    // Successful scanner re-run → all previously-open findings from this
    // scanner on this PR have been resolved. Auto-close them.
    if (checkRun.conclusion === 'success') {
      const closed = queries.markScannerEventsAutoClosed(
        repo,
        prNumber,
        scannerLogin,
        `scanner_check_success:${checkRun.name}`
      )
      // Still route through handleScannerCheckCompleted so PR-green flow
      // can fire when all checks pass.
      await handleScannerCheckCompleted({
        repo,
        prNumber,
        checkRunId: checkRun.id,
        checkName: checkRun.name,
        conclusion: 'success',
        startedAt: new Date(checkRun.started_at),
        completedAt: new Date(checkRun.completed_at ?? new Date().toISOString()),
        scannerLogin,
      })
      return {
        disposition: 'auto_closed',
        reason: `scanner_check_success closed ${closed} event(s)`,
        prNumber,
        actor: scannerLogin,
        repo,
      }
    }

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
    return {
      disposition: isLinked ? 'dispatched' : 'notified',
      reason: `scanner_check:${scannerLogin}`,
      prNumber,
      actor: scannerLogin,
      repo,
    }
  }

  if (checkRun.conclusion === 'failure') {
    await handleCIFailure({ repo, prNumber, checkRun })
    return {
      disposition: isLinked ? 'dispatched' : 'notified',
      reason: 'ci_failure',
      prNumber,
      actor: checkRun.app?.slug ?? checkRun.name,
      repo,
    }
  }

  return {
    disposition: 'dropped',
    reason: `not_scanner_and_conclusion=${checkRun.conclusion ?? 'null'}`,
    prNumber,
    actor: checkRun.app?.slug ?? checkRun.name,
    repo,
  }
}

interface PullRequestPayload {
  action: string
  pull_request: {
    number: number
    user?: { login: string } | null
    merged?: boolean
    merged_at?: string | null
  }
  repository: { full_name: string }
}

async function handlePullRequest(payload: Record<string, unknown>): Promise<Outcome> {
  const p = payload as unknown as PullRequestPayload
  if (p.action === 'closed' && p.pull_request) {
    const repo = p.repository.full_name
    const prNumber = p.pull_request.number
    if (p.pull_request.merged) {
      queries.markSessionMerged(repo, prNumber, p.pull_request.merged_at ?? new Date().toISOString())
      return {
        disposition: 'dispatched',
        reason: 'pr_merged',
        prNumber,
        actor: p.pull_request.user?.login ?? undefined,
        repo,
      }
    }
    await unlinkSession(repo, prNumber, 'pr_closed')
    return {
      disposition: 'dispatched',
      reason: 'pr_closed_unlinked',
      prNumber,
      actor: p.pull_request.user?.login ?? undefined,
      repo,
    }
  }
  return {
    disposition: 'dropped',
    reason: `pr_action_${p.action}_ignored`,
    prNumber: p.pull_request?.number,
    repo: p.repository.full_name,
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

async function handleReviewComment(payload: Record<string, unknown>): Promise<Outcome> {
  const p = payload as unknown as ReviewCommentPayload
  const actor = p.comment.user?.login
  if (!actor) return { disposition: 'dropped', reason: 'no_actor' }
  if (!isScannerBot(actor)) {
    return {
      disposition: 'dropped',
      reason: 'actor_not_in_scanner_list',
      prNumber: p.pull_request.number,
      actor,
      repo: p.repository.full_name,
    }
  }

  if (p.action === 'deleted') {
    const id = queries.eventIdForComment(p.repository.full_name, p.comment.id)
    const closed = queries.markEventAutoClosed(id, 'review_comment_deleted')
    return {
      disposition: closed > 0 ? 'auto_closed' : 'dropped',
      reason: closed > 0 ? 'review_comment_deleted' : 'delete_no_matching_event',
      prNumber: p.pull_request.number,
      actor,
      repo: p.repository.full_name,
    }
  }

  if (p.action !== 'created') {
    return { disposition: 'dropped', reason: `action_${p.action}_ignored` }
  }

  const event = normalizeScannerComment(p.comment, p.repository.full_name, p.pull_request.number, {
    prTitle: p.pull_request.title,
    prUrl: p.pull_request.html_url,
    prAuthor: p.pull_request.user?.login ?? '',
  })
  return recordAndDispatch(event, p.repository.full_name, p.pull_request.number, event.prTitle, event.prUrl, actor)
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

async function handleIssueComment(payload: Record<string, unknown>): Promise<Outcome> {
  const p = payload as unknown as IssueCommentPayload
  if (!p.issue.pull_request) {
    return { disposition: 'dropped', reason: 'comment_on_issue_not_pr' }
  }
  const actor = p.comment.user?.login
  if (!actor) return { disposition: 'dropped', reason: 'no_actor' }
  if (!isScannerBot(actor)) {
    return {
      disposition: 'dropped',
      reason: 'actor_not_in_scanner_list',
      prNumber: p.issue.number,
      actor,
      repo: p.repository.full_name,
    }
  }

  if (p.action === 'deleted') {
    const id = queries.eventIdForComment(p.repository.full_name, p.comment.id)
    const closed = queries.markEventAutoClosed(id, 'issue_comment_deleted')
    return {
      disposition: closed > 0 ? 'auto_closed' : 'dropped',
      reason: closed > 0 ? 'issue_comment_deleted' : 'delete_no_matching_event',
      prNumber: p.issue.number,
      actor,
      repo: p.repository.full_name,
    }
  }

  if (p.action !== 'created') {
    return { disposition: 'dropped', reason: `action_${p.action}_ignored` }
  }

  const event = normalizeScannerComment(p.comment, p.repository.full_name, p.issue.number, {
    prTitle: p.issue.title,
    prUrl: p.issue.html_url,
    prAuthor: p.issue.user?.login ?? '',
  })
  return recordAndDispatch(event, p.repository.full_name, p.issue.number, event.prTitle, event.prUrl, actor)
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

async function handlePullRequestReview(payload: Record<string, unknown>): Promise<Outcome> {
  const p = payload as unknown as PullRequestReviewPayload
  if (p.action !== 'submitted') {
    return { disposition: 'dropped', reason: `action_${p.action}_ignored` }
  }
  const actor = p.review.user?.login
  if (!actor) return { disposition: 'dropped', reason: 'no_actor' }
  if (!isScannerBot(actor)) {
    return {
      disposition: 'dropped',
      reason: 'actor_not_in_scanner_list',
      prNumber: p.pull_request.number,
      actor,
      repo: p.repository.full_name,
    }
  }
  if (!p.review.body) {
    return {
      disposition: 'dropped',
      reason: 'review_has_no_body',
      prNumber: p.pull_request.number,
      actor,
      repo: p.repository.full_name,
    }
  }

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
  return recordAndDispatch(event, p.repository.full_name, p.pull_request.number, event.prTitle, event.prUrl, actor)
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
  prUrl: string,
  actor: string
): Promise<Outcome> {
  queries.insertEvent(event)
  const batch: EventBatch = { repo, prNumber, events: [event] }
  const prMeta: PRMeta = { prTitle, prUrl }
  const linked = queries.getLinkedSession(repo, prNumber)
  if (linked && !linked.unlinked_at) {
    await injectIntoSession(linked, batch, prMeta)
    return { disposition: 'dispatched', reason: 'linked_session', prNumber, actor, repo }
  }
  await sendBatchNotification(batch, prMeta)
  return { disposition: 'notified', reason: 'no_linked_session', prNumber, actor, repo }
}
