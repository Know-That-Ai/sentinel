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
 * TODO: Full implementation requires Phase 4 dispatch functions.
 * Currently a no-op stub.
 */
export async function handleDispatchEvent(eventId: string): Promise<void> {
  // TODO: Implement once Phase 4 dispatch functions are available
  // 1. Look up the event by ID
  // 2. Determine the target agent
  // 3. Call dispatchEvent from agents/index.ts
}
