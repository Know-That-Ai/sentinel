import * as queries from '../db/queries.js'
import { sendBatchNotification } from '../notifications/index.js'
import { getAutoDispatchRules } from '../config.js'
import { fetchScannerComments, getPRMeta, postPRComment, deletePRComment } from '../github/client.js'
import { dispatchToClaudeCode } from './claude-code.js'
import { injectIntoSession } from './inject.js'
import { buildBatchPrompt } from './prompts.js'
import type { EventBatch, SentinelEvent, PRMeta } from '../github/events.js'

export { type EventBatch } from '../github/events.js'

export interface ScannerCheckCompletedParams {
  repo: string
  prNumber: number
  checkRunId: number
  checkName: string
  conclusion: string
  startedAt: Date
  completedAt: Date
  scannerLogin: string
}

export interface CIFailureParams {
  repo: string
  prNumber: number
  checkRun: {
    id: number
    name: string
    conclusion: string | null
    started_at: string
    completed_at: string | null
  }
}

export async function handleScannerCheckCompleted(params: ScannerCheckCompletedParams): Promise<void> {
  const { repo, prNumber, scannerLogin, startedAt, checkName, conclusion } = params

  // Record the trigger and update per-check health state
  queries.insertCheckRunTrigger(params)
  queries.upsertPRHealth({ repo, prNumber, checkName, conclusion, lastRunAt: params.completedAt })

  // If this check passed, evaluate whether the whole PR is now green
  if (conclusion === 'success') {
    if (await isPRGreen(repo, prNumber)) {
      const prUrl = `https://github.com/${repo}/pull/${prNumber}`
      await handlePRGreen(repo, prNumber, prUrl)
    }
    return
  }

  // Fetch all comments this scanner left during the run
  const events = await fetchScannerComments(
    null as any, // octokit — mocked in tests
    repo, prNumber, scannerLogin, startedAt,
    { prTitle: '', prUrl: `https://github.com/${repo}/pull/${prNumber}` }
  )

  for (const event of events) {
    queries.insertEvent(event)
  }

  if (events.length === 0) return

  const prMeta: PRMeta = { prTitle: events[0]?.prTitle ?? '', prUrl: events[0]?.prUrl ?? '' }
  const batch: EventBatch = { repo, prNumber, events }

  const linkedSession = queries.getLinkedSession(repo, prNumber)

  if (linkedSession && !linkedSession.unlinked_at) {
    await injectIntoSession(linkedSession, batch, prMeta)
  } else {
    await sendBatchNotification(batch, prMeta)
    if (shouldAutoDispatch(events)) {
      await dispatchBatch(batch, prMeta)
    }
  }
}

export async function handleCIFailure(params: CIFailureParams): Promise<void> {
  const { repo, prNumber, checkRun } = params

  queries.upsertPRHealth({
    repo, prNumber,
    checkName: checkRun.name,
    conclusion: checkRun.conclusion ?? 'failure',
    lastRunAt: new Date(checkRun.completed_at ?? new Date().toISOString()),
  })

  const event: SentinelEvent = {
    id: `ci-failure-${checkRun.id}`,
    repo,
    prNumber,
    prTitle: '',
    prUrl: `https://github.com/${repo}/pull/${prNumber}`,
    prAuthor: '',
    eventType: 'check_failure',
    source: 'ci',
    actor: checkRun.name,
    body: `Check "${checkRun.name}" failed with conclusion: ${checkRun.conclusion}`,
    githubUrl: `https://github.com/${repo}/pull/${prNumber}`,
    receivedAt: new Date(),
  }

  queries.insertEvent(event)

  const prMeta: PRMeta = { prTitle: event.prTitle, prUrl: event.prUrl }
  const batch: EventBatch = { repo, prNumber, events: [event] }

  const linkedSession = queries.getLinkedSession(repo, prNumber)
  if (linkedSession && !linkedSession.unlinked_at) {
    await injectIntoSession(linkedSession, batch, prMeta)
  } else {
    await sendBatchNotification(batch, prMeta)
    if (shouldAutoDispatch([event])) {
      await dispatchBatch(batch, prMeta)
    }
  }
}

export async function unlinkSession(
  repo: string,
  prNumber: number,
  reason: 'pr_closed' | 'pr_merged' | 'process_exit' | 'manual'
): Promise<void> {
  const session = queries.getLinkedSession(repo, prNumber)
  if (!session) return

  if (session.sentinel_comment_id) {
    const [owner, repoName] = repo.split('/')
    await deletePRComment(owner, repoName, session.sentinel_comment_id)
  }

  queries.unlinkSession(repo, prNumber, reason)
}

export async function dispatchBatch(batch: EventBatch, prMeta: PRMeta): Promise<void> {
  const openClawLogins = (process.env.OPENCLAW_GITHUB_LOGINS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

  const prAuthor = batch.events[0]?.prAuthor?.toLowerCase() ?? ''
  const preferredAgent = process.env.PREFERRED_AGENT ?? 'claude-code'

  const prAuthorIsOpenClaw = openClawLogins.length > 0 && openClawLogins.includes(prAuthor)

  if (preferredAgent === 'openclaw' && prAuthorIsOpenClaw) {
    try {
      const { isOpenClawRunning, dispatchToOpenClaw } = await import('./openclaw.js')
      if (await isOpenClawRunning()) {
        await dispatchToOpenClaw(batch, prMeta)
        return
      }
    } catch {
      // Fall through to claude-code
    }
  }

  await dispatchToClaudeCode(batch, prMeta)
}

export async function isPRGreen(repo: string, prNumber: number): Promise<boolean> {
  const checks = queries.getPRHealth(repo, prNumber)
  if (checks.length === 0) return false

  const allPassing = checks.every(c => c.last_conclusion === 'success')
  if (!allPassing) return false

  const openScannerEvents = queries.getUnreviewedScannerEvents(repo, prNumber)
  return openScannerEvents.length === 0
}

export async function handlePRGreen(repo: string, prNumber: number, prUrl: string): Promise<void> {
  const notifier = (await import('node-notifier')).default

  notifier.notify({
    title: `\u2705 PR #${prNumber} is fully green`,
    message: `${repo} \u2014 all checks passing, no scanner issues remaining`,
    open: prUrl,
  })

  const [owner, repoName] = repo.split('/')
  await postPRComment(
    owner, repoName, prNumber,
    `**Sentinel** \u2705 All checks passing \u2014 no BugBot, CodeQL, or CI issues remaining.\nPR is ready for review.`
  )

  // Unlink any active session
  await unlinkSession(repo, prNumber, 'pr_closed')
}

export function shouldAutoDispatch(events: SentinelEvent[]): boolean {
  const rules = getAutoDispatchRules()
  return events.some(e =>
    (rules.bugbot && e.source === 'bugbot') ||
    (rules.codeql && e.source === 'codeql') ||
    (rules.ci && e.eventType === 'check_failure')
  )
}
