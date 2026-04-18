import crypto from 'crypto'
import { getDB } from './index.js'
import type { SentinelEvent } from '../github/events.js'

// --- Table introspection ---

export function getTableNames(): string[] {
  const db = getDB()
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>
  return rows.map(r => r.name)
}

// --- Events ---

export function insertEvent(event: SentinelEvent): void {
  const db = getDB()
  db.prepare(`
    INSERT OR IGNORE INTO events (id, repo, pr_number, pr_title, pr_url, pr_author, event_type, source, actor, body, github_url, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.id, event.repo, event.prNumber, event.prTitle, event.prUrl, event.prAuthor,
    event.eventType, event.source, event.actor, event.body ?? null,
    event.githubUrl, event.receivedAt.toISOString()
  )
}

export function getEventById(id: string): EventRow | null {
  const db = getDB()
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined ?? null
}

export function getUnreviewedEvents(): EventRow[] {
  const db = getDB()
  return db.prepare('SELECT * FROM events WHERE reviewed = 0 ORDER BY received_at DESC').all() as EventRow[]
}

export function getUnreviewedScannerEvents(repo: string, prNumber: number): EventRow[] {
  const db = getDB()
  return db.prepare(
    "SELECT * FROM events WHERE repo = ? AND pr_number = ? AND reviewed = 0 AND source IN ('bugbot', 'codeql')"
  ).all(repo, prNumber) as EventRow[]
}

export function markEventReviewed(id: string): void {
  const db = getDB()
  db.prepare('UPDATE events SET reviewed = 1 WHERE id = ?').run(id)
}

export function markEventNotified(id: string): void {
  const db = getDB()
  db.prepare('UPDATE events SET notified = 1 WHERE id = ?').run(id)
}

// --- PR Health ---

export interface PRHealthParams {
  repo: string
  prNumber: number
  checkName: string
  conclusion: string
  lastRunAt: Date
}

export function upsertPRHealth(params: PRHealthParams): void {
  const db = getDB()
  db.prepare(`
    INSERT INTO pr_health (repo, pr_number, check_name, last_conclusion, last_run_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(repo, pr_number, check_name) DO UPDATE SET
      last_conclusion = excluded.last_conclusion,
      last_run_at = excluded.last_run_at
  `).run(params.repo, params.prNumber, params.checkName, params.conclusion, params.lastRunAt.toISOString())
}

export function getPRHealth(repo: string, prNumber: number): PRHealthRow[] {
  const db = getDB()
  return db.prepare('SELECT * FROM pr_health WHERE repo = ? AND pr_number = ?')
    .all(repo, prNumber) as PRHealthRow[]
}

// --- Linked Sessions ---

export interface InsertLinkedSessionParams {
  id: string
  repo: string
  prNumber: number
  agentType: string
  terminalPid: number | null
  tty: string | null
  tmuxPane: string | null
  repoPath: string
  linkedAt: string
}

export function insertLinkedSession(params: InsertLinkedSessionParams): void {
  const db = getDB()
  db.prepare(`
    INSERT OR REPLACE INTO linked_sessions (id, repo, pr_number, agent_type, terminal_pid, tty, tmux_pane, repo_path, linked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id, params.repo, params.prNumber, params.agentType,
    params.terminalPid, params.tty, params.tmuxPane, params.repoPath, params.linkedAt
  )
}

export function getLinkedSession(repo: string, prNumber: number): LinkedSessionRow | null {
  const db = getDB()
  return db.prepare('SELECT * FROM linked_sessions WHERE repo = ? AND pr_number = ?')
    .get(repo, prNumber) as LinkedSessionRow | undefined ?? null
}

export function getActiveLinkedSessions(): LinkedSessionRow[] {
  const db = getDB()
  return db.prepare('SELECT * FROM linked_sessions WHERE unlinked_at IS NULL')
    .all() as LinkedSessionRow[]
}

export function unlinkSession(repo: string, prNumber: number, reason: string): void {
  const db = getDB()
  db.prepare('UPDATE linked_sessions SET unlinked_at = ?, unlink_reason = ? WHERE repo = ? AND pr_number = ?')
    .run(new Date().toISOString(), reason, repo, prNumber)
}

export function updateLinkedSessionCommentId(sessionId: string, commentId: number): void {
  const db = getDB()
  db.prepare('UPDATE linked_sessions SET sentinel_comment_id = ? WHERE id = ?')
    .run(commentId, sessionId)
}

// --- Check Run Triggers ---

export interface InsertCheckRunTriggerParams {
  repo: string
  prNumber: number
  checkRunId: number
  checkName: string
  conclusion: string
  startedAt: Date
  completedAt: Date
}

export function insertCheckRunTrigger(params: InsertCheckRunTriggerParams): void {
  const db = getDB()
  const id = crypto.createHash('sha256')
    .update(`${params.repo}:${params.checkRunId}`)
    .digest('hex')

  db.prepare(`
    INSERT OR IGNORE INTO check_run_triggers (id, repo, pr_number, check_run_id, check_name, conclusion, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, params.repo, params.prNumber, params.checkRunId, params.checkName, params.conclusion, params.startedAt.toISOString(), params.completedAt.toISOString())
}

export function getCheckRunTrigger(repo: string, checkRunId: number): CheckRunTriggerRow | null {
  const db = getDB()
  return db.prepare('SELECT * FROM check_run_triggers WHERE repo = ? AND check_run_id = ?')
    .get(repo, checkRunId) as CheckRunTriggerRow | undefined ?? null
}

// --- Watched Repos ---

export function insertWatchedRepo(fullName: string): void {
  const db = getDB()
  db.prepare('INSERT OR IGNORE INTO watched_repos (full_name) VALUES (?)').run(fullName)
}

export function getWatchedRepo(fullName: string): WatchedRepoRow | null {
  const db = getDB()
  return db.prepare('SELECT * FROM watched_repos WHERE full_name = ?')
    .get(fullName) as WatchedRepoRow | undefined ?? null
}

export function getActiveWatchedRepos(): WatchedRepoRow[] {
  const db = getDB()
  return db.prepare('SELECT * FROM watched_repos WHERE active = 1')
    .all() as WatchedRepoRow[]
}

export function updateLastPolled(fullName: string): void {
  const db = getDB()
  db.prepare('UPDATE watched_repos SET last_polled = ? WHERE full_name = ?')
    .run(new Date().toISOString(), fullName)
}

// --- Dispatch Log ---

export interface InsertDispatchLogParams {
  id: string
  eventId: string | null
  agent: string
  prompt: string
  startedAt: string
  status: string
}

export function insertDispatchLog(params: InsertDispatchLogParams): void {
  const db = getDB()
  db.prepare(`
    INSERT INTO dispatch_log (id, event_id, agent, prompt, started_at, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(params.id, params.eventId, params.agent, params.prompt, params.startedAt, params.status)
}

export function updateDispatchLog(id: string, status: string, response?: string): void {
  const db = getDB()
  db.prepare('UPDATE dispatch_log SET status = ?, response = ?, completed_at = ? WHERE id = ?')
    .run(status, response ?? null, new Date().toISOString(), id)
}

// --- Row types ---

export interface EventRow {
  id: string
  repo: string
  pr_number: number
  pr_title: string
  pr_url: string
  pr_author: string
  event_type: string
  source: string
  actor: string
  body: string | null
  github_url: string
  received_at: string
  notified: number
  reviewed: number
  dispatched_to: string | null
  dispatched_at: string | null
  dispatch_status: string | null
}

export interface PRHealthRow {
  repo: string
  pr_number: number
  check_name: string
  last_conclusion: string
  last_run_at: string
}

export interface LinkedSessionRow {
  id: string
  repo: string
  pr_number: number
  agent_type: string
  terminal_pid: number | null
  tty: string | null
  tmux_pane: string | null
  repo_path: string
  linked_at: string
  unlinked_at: string | null
  unlink_reason: string | null
  sentinel_comment_id: number | null
}

export interface CheckRunTriggerRow {
  id: string
  repo: string
  pr_number: number
  check_run_id: number
  check_name: string
  conclusion: string
  started_at: string
  completed_at: string
  dispatched: number
  dispatched_at: string | null
}

export interface WatchedRepoRow {
  full_name: string
  active: number
  last_polled: string | null
  webhook_id: number | null
}

// --- Webhook audit log ---

export type WebhookDisposition = 'dispatched' | 'notified' | 'dropped'

export interface WebhookLogParams {
  id?: string
  receivedAt?: string
  eventType: string
  action?: string | null
  repo?: string | null
  prNumber?: number | null
  actor?: string | null
  disposition: WebhookDisposition
  reason?: string | null
  deliveryId?: string | null
}

export interface WebhookLogRow {
  id: string
  received_at: string
  event_type: string
  action: string | null
  repo: string | null
  pr_number: number | null
  actor: string | null
  disposition: WebhookDisposition
  reason: string | null
  delivery_id: string | null
}

export function insertWebhookLog(params: WebhookLogParams): void {
  const db = getDB()
  db.prepare(`
    INSERT INTO webhook_log (id, received_at, event_type, action, repo, pr_number, actor, disposition, reason, delivery_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.id ?? crypto.randomUUID(),
    params.receivedAt ?? new Date().toISOString(),
    params.eventType,
    params.action ?? null,
    params.repo ?? null,
    params.prNumber ?? null,
    params.actor ?? null,
    params.disposition,
    params.reason ?? null,
    params.deliveryId ?? null,
  )
}

export function getRecentWebhookLog(limit: number = 200): WebhookLogRow[] {
  const db = getDB()
  return db.prepare(
    'SELECT * FROM webhook_log ORDER BY received_at DESC LIMIT ?'
  ).all(limit) as WebhookLogRow[]
}
