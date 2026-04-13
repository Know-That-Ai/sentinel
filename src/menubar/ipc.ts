import * as queries from '../db/queries.js'
import type { LinkedSessionRow, EventRow } from '../db/queries.js'
import type { SentinelEvent } from '../github/events.js'
import type { Menubar } from 'menubar'

/**
 * Wires up Electron IPC handlers so the renderer can call into main process.
 */
export function setupIPC(mb: Menubar): void {
  let ipcMain: typeof import('electron').ipcMain
  try {
    ipcMain = require('electron').ipcMain
  } catch {
    // Not running in Electron context (e.g. tests) — skip IPC registration
    return
  }

  ipcMain.handle('get-unreviewed', async () => handleGetUnreviewed())
  ipcMain.handle('mark-reviewed', async (_event: unknown, eventId: string) => handleMarkReviewed(eventId))
  ipcMain.handle('get-linked-sessions', async () => handleGetLinkedSessions())
  ipcMain.handle('dispatch-event', async (_event: unknown, eventId: string) => handleDispatchEvent(eventId))
  ipcMain.handle('quit-app', () => {
    const { app } = require('electron')
    app.quit()
  })
}

/**
 * Returns all unreviewed events, ordered by most recent first.
 */
export async function handleGetUnreviewed(): Promise<EventRow[]> {
  return queries.getUnreviewedEvents()
}

/**
 * Marks a single event as reviewed by its ID.
 */
export async function handleMarkReviewed(eventId: string): Promise<void> {
  queries.markEventReviewed(eventId)
}

/**
 * Returns all currently active (not unlinked) sessions.
 */
export async function handleGetLinkedSessions(): Promise<LinkedSessionRow[]> {
  return queries.getActiveLinkedSessions()
}

/**
 * Dispatches an event to the appropriate agent.
 */
export async function handleDispatchEvent(eventId: string): Promise<void> {
  const event = queries.getEventById(eventId)
  if (!event) return

  const batch = {
    repo: event.repo,
    prNumber: event.pr_number,
    events: [{
      id: event.id,
      repo: event.repo,
      prNumber: event.pr_number,
      prTitle: event.pr_title,
      prUrl: event.pr_url,
      prAuthor: event.pr_author,
      eventType: event.event_type as SentinelEvent['eventType'],
      source: event.source as SentinelEvent['source'],
      actor: event.actor,
      body: event.body ?? undefined,
      githubUrl: event.github_url,
      receivedAt: new Date(event.received_at),
    }],
  }
  const prMeta = { prTitle: event.pr_title, prUrl: event.pr_url }
  const { dispatchBatch } = await import('../agents/index.js')
  await dispatchBatch(batch, prMeta)
}
