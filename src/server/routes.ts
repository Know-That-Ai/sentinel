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
    const anyPending = checks.some(
      (c) => c.last_conclusion === 'pending' || c.last_conclusion === 'in_progress'
    )
    let pr_status: 'green' | 'red' | 'pending' | 'unknown'
    if (!hasChecks) pr_status = 'unknown'
    else if (anyFailure || openEvents > 0) pr_status = 'red'
    else if (anyPending) pr_status = 'pending'
    else pr_status = 'green'
    return {
      ...s,
      pr_status,
      open_events: openEvents,
      checks: checks.map((c) => ({
        name: c.check_name,
        conclusion: c.last_conclusion,
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

healthRouter.post('/state/dispatch/:id', async (req, res) => {
  try {
    const event = queries.getEventById(req.params.id)
    if (!event) {
      res.status(404).json({ error: 'Event not found' })
      return
    }
    const { dispatchBatch } = await import('../agents/index.js')
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
    await dispatchBatch(batch, { prTitle: event.pr_title, prUrl: event.pr_url })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
