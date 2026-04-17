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

async function main(): Promise<void> {
  initDB(DB_PATH)

  const app = createApp()
  app.listen(PORT, () => {
    console.log(`Sentinel daemon listening on port ${PORT}`)
  })

  await watchLinkedSessions()
  console.log('Sentinel is running. PID watcher active.')

  const { startPoller } = await import('./github/poller.js')
  const { getOctokit } = await import('./github/octokit.js')
  startPoller(getOctokit())
  console.log('Poller started (60s interval)')
}

main().catch((err) => {
  console.error('Sentinel failed to start:', err)
  process.exit(1)
})
