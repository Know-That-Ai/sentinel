import { Router } from 'express'
import * as queries from '../db/queries.js'

export const healthRouter = Router()

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

healthRouter.get('/state/config', (_req, res) => {
  res.json({
    githubOrg: process.env.GITHUB_ORG ?? '',
    githubUsername: process.env.GITHUB_USERNAME ?? '',
    userLabel: process.env.SENTINEL_USER_LABEL ?? '',
    preferredAgent: process.env.PREFERRED_AGENT ?? 'claude-code',
    openclawUrl: process.env.OPENCLAW_URL ?? 'http://localhost:4000',
    openclawApiKey: process.env.OPENCLAW_API_KEY ?? '',
    repoPaths: JSON.parse(process.env.REPO_PATHS ?? '{}'),
    scannerBotLogins: (process.env.SCANNER_BOT_LOGINS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean),
    smeeUrl: process.env.SMEE_URL ?? '',
    port: parseInt(process.env.PORT ?? '3847', 10),
    autoDispatchBugbot: process.env.AUTO_DISPATCH_BUGBOT === 'true',
    autoDispatchCodeql: process.env.AUTO_DISPATCH_CODEQL === 'true',
    autoDispatchCI: process.env.AUTO_DISPATCH_CI === 'true',
    autoSubmit: process.env.SENTINEL_AUTO_SUBMIT !== 'false',
  })
})

healthRouter.get('/state/unreviewed', (_req, res) => {
  const events = queries.getUnreviewedEvents()
  res.json(events)
})

healthRouter.get('/state/sessions', (_req, res) => {
  const sessions = queries.getActiveLinkedSessions()
  const openEventsByKey = new Map<string, number>()
  for (const e of queries.getUnreviewedEvents()) {
    const k = `${e.repo.toLowerCase()}#${e.pr_number}`
    openEventsByKey.set(k, (openEventsByKey.get(k) ?? 0) + 1)
  }
  const enriched = sessions.map((s) => {
    const checks = queries.getPRHealth(s.repo, s.pr_number)
    const key = `${s.repo.toLowerCase()}#${s.pr_number}`
    const openEvents = openEventsByKey.get(key) ?? 0
    const hasChecks = checks.length > 0
    const anyFailure = checks.some(
      (c) => c.last_conclusion === 'failure' || c.last_conclusion === 'timed_out'
    )
    const anyInProgress = checks.some(
      (c) => c.status === 'in_progress' || c.status === 'queued'
    )

    // Precedence: merged > in_progress > failure > openEvents > green > unknown
    let pr_status: 'green' | 'red' | 'pending' | 'unknown' | 'merged'
    if (s.merged_at) pr_status = 'merged'
    else if (anyInProgress) pr_status = 'pending'
    else if (anyFailure) pr_status = 'red'
    else if (openEvents > 0) pr_status = 'red'
    else if (hasChecks) pr_status = 'green'
    else pr_status = 'unknown'

    return {
      ...s,
      pr_status,
      open_events: openEvents,
      checks: checks.map((c) => ({
        name: c.check_name,
        conclusion: c.last_conclusion,
        status: c.status,
        last_run_at: c.last_run_at,
      })),
    }
  })
  res.json(enriched)
})

healthRouter.get('/state/webhook-log', (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '200', 10) || 200, 1000)
  res.json(queries.getRecentWebhookLog(limit))
})

healthRouter.post('/state/mark-reviewed/:id', (req, res) => {
  queries.markEventReviewed(req.params.id)
  res.json({ ok: true })
})

healthRouter.post('/state/sessions/:id/focus', async (req, res) => {
  const session = queries.getActiveLinkedSessions().find((s) => s.id === req.params.id)
  if (!session) {
    res.status(404).json({ ok: false, reason: 'session_not_found' })
    return
  }
  const { focusSessionTerminal } = await import('../agents/inject.js')
  const result = focusSessionTerminal(session)
  res.json(result)
})

healthRouter.post('/state/dispatch/:id', async (req, res) => {
  try {
    const event = queries.getEventById(req.params.id)
    if (!event) {
      res.status(404).json({ error: 'Event not found' })
      return
    }
    const batch = {
      repo: event.repo,
      prNumber: event.pr_number,
      events: [{
        id: event.id, repo: event.repo, prNumber: event.pr_number,
        prTitle: event.pr_title, prUrl: event.pr_url, prAuthor: event.pr_author,
        eventType: event.event_type as any, source: event.source as any,
        actor: event.actor, body: event.body ?? undefined,
        githubUrl: event.github_url, receivedAt: new Date(event.received_at),
      }],
    }
    const prMeta = { prTitle: event.pr_title, prUrl: event.pr_url }

    // If the PR has a linked Claude session, inject directly into that tab
    // (same path as a live webhook dispatch). Otherwise fall back to
    // spawning a headless agent, which requires REPO_PATHS to be configured.
    const linked = queries.getLinkedSession(event.repo, event.pr_number)
    if (linked && !linked.unlinked_at) {
      const { injectIntoSession } = await import('../agents/inject.js')
      const result = await injectIntoSession(linked, batch, prMeta)
      res.json({
        ok: true,
        mode: 'injected',
        delivered: result.delivered,
        via: result.via,
        reason: result.reason,
        inboxPath: result.inboxPath,
        session: linked.id,
      })
      return
    }

    const { dispatchBatch } = await import('../agents/index.js')
    await dispatchBatch(batch, prMeta)
    res.json({ ok: true, mode: 'spawned' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dispatch] failed:', msg)
    res.status(500).json({ error: msg })
  }
})
