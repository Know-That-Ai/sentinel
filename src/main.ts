import 'dotenv/config'
import os from 'os'
import path from 'path'
import { initDB } from './db/index.js'
import { createApp } from './server/index.js'
import * as queries from './db/queries.js'

const PORT = parseInt(process.env.PORT ?? '3847', 10)
const DB_PATH =
  process.env.SENTINEL_DB_PATH ?? path.join(os.homedir(), '.sentinel', 'sentinel.db')

async function watchLinkedSessions(): Promise<void> {
  setInterval(async () => {
    const activeSessions = queries.getActiveLinkedSessions()

    for (const session of activeSessions) {
      if (!session.terminal_pid) continue

      const isAlive = (() => {
        try { process.kill(session.terminal_pid!, 0); return true }
        catch { return false }
      })()

      if (!isAlive) {
        const { unlinkSession } = await import('./agents/index.js')
        await unlinkSession(session.repo, session.pr_number, 'process_exit')
      }
    }
  }, 15_000)
}

async function reconcileSessionStatus(): Promise<void> {
  // Catches missed webhooks (merge or check-run state) for active sessions.
  // Runs on startup and every 2 minutes.
  const { getOctokit } = await import('./github/octokit.js')
  const run = async () => {
    try {
      const octokit = getOctokit()
      for (const s of queries.getActiveLinkedSessions()) {
        const [owner, repo] = s.repo.split('/')
        if (!owner || !repo) continue
        try {
          const { data: pr } = await octokit.pulls.get({ owner, repo, pull_number: s.pr_number })

          if (!s.merged_at && pr.merged && pr.merged_at) {
            queries.markSessionMerged(s.repo, s.pr_number, pr.merged_at)
            console.log(`[reconcile] ${s.repo}#${s.pr_number} marked merged`)
          }

          // Fetch live check-run state for the PR's head sha. Any check whose
          // status is queued/in_progress gives the session a yellow indicator
          // even if we missed the created webhook.
          const { data: checks } = await octokit.checks.listForRef({
            owner,
            repo,
            ref: pr.head.sha,
            per_page: 100,
          })
          for (const c of checks.check_runs) {
            queries.upsertPRHealth({
              repo: s.repo,
              prNumber: s.pr_number,
              checkName: c.name,
              conclusion: c.conclusion ?? 'pending',
              lastRunAt: new Date(c.completed_at ?? c.started_at ?? new Date().toISOString()),
              status: c.status, // queued | in_progress | completed
            })
          }
        } catch {
          // ignore per-PR errors (rate limits, not-found, 403, etc.)
        }
      }
    } catch {
      // missing PAT or other config — skip silently
    }
  }
  await run()
  setInterval(run, 2 * 60_000)
}

async function main(): Promise<void> {
  initDB(DB_PATH)

  const app = createApp()
  app.listen(PORT, () => {
    console.log(`Sentinel daemon listening on port ${PORT}`)
  })

  await watchLinkedSessions()
  console.log('Sentinel is running. PID watcher active.')

  reconcileSessionStatus().catch((err) => console.error('[reconcile] failed:', err))

  const { startPoller } = await import('./github/poller.js')
  const { getOctokit } = await import('./github/octokit.js')
  startPoller(getOctokit())
  console.log('Poller started (60s interval)')
}

main().catch((err) => {
  console.error('Sentinel failed to start:', err)
  process.exit(1)
})
