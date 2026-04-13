import { Router } from 'express'
import * as queries from '../db/queries.js'

export const healthRouter = Router()

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() })
})

healthRouter.get('/state/unreviewed', (_req, res) => {
  const events = queries.getUnreviewedEvents()
  res.json(events)
})

healthRouter.get('/state/sessions', (_req, res) => {
  const sessions = queries.getActiveLinkedSessions()
  res.json(sessions)
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
