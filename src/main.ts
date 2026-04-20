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

async function reconcileMergedPRs(): Promise<void> {
  // Catch sessions whose PRs were merged while the daemon was down (or before
  // pr.closed webhooks existed). Runs once at startup and then every 5 min.
  const { getOctokit } = await import('./github/octokit.js')
  const run = async () => {
    try {
      const octokit = getOctokit()
      for (const s of queries.getActiveLinkedSessions()) {
        if (s.merged_at) continue
        const [owner, repo] = s.repo.split('/')
        if (!owner || !repo) continue
        try {
          const { data } = await octokit.pulls.get({ owner, repo, pull_number: s.pr_number })
          if (data.merged && data.merged_at) {
            queries.markSessionMerged(s.repo, s.pr_number, data.merged_at)
            console.log(`[reconcile] ${s.repo}#${s.pr_number} marked merged`)
          }
        } catch {
          // ignore per-PR errors (rate limits, not-found, etc.)
        }
      }
    } catch {
      // missing PAT or other config — skip silently
    }
  }
  await run()
  setInterval(run, 5 * 60_000)
}

async function main(): Promise<void> {
  initDB(DB_PATH)

  const app = createApp()
  app.listen(PORT, () => {
    console.log(`Sentinel daemon listening on port ${PORT}`)
  })

  await watchLinkedSessions()
  console.log('Sentinel is running. PID watcher active.')

  reconcileMergedPRs().catch((err) => console.error('[reconcile] failed:', err))

  const { startPoller } = await import('./github/poller.js')
  const { getOctokit } = await import('./github/octokit.js')
  startPoller(getOctokit())
  console.log('Poller started (60s interval)')
}

main().catch((err) => {
  console.error('Sentinel failed to start:', err)
  process.exit(1)
})
