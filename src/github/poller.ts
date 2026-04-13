import type { Octokit } from '@octokit/rest'
import * as queries from '../db/queries.js'
import { classifyCheckAsScannerBot } from './events.js'
import { handleScannerCheckCompleted } from '../agents/index.js'

export function startPoller(octokit: Octokit, intervalMs: number = 60_000): ReturnType<typeof setInterval> {
  return setInterval(() => {
    pollOnce(octokit).catch(err => {
      console.error('Poller tick error:', err)
    })
  }, intervalMs)
}

export async function pollOnce(octokit: Octokit): Promise<void> {
  const repos = queries.getActiveWatchedRepos()

  const scannerLogins = (process.env.SCANNER_BOT_LOGINS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

  for (const repo of repos) {
    try {
      await pollRepo(octokit, repo.full_name, scannerLogins)
      queries.updateLastPolled(repo.full_name)
    } catch (err) {
      console.error(`Poller error for ${repo.full_name}:`, err)
    }
  }
}

async function pollRepo(
  octokit: Octokit,
  repoFullName: string,
  scannerLogins: string[]
): Promise<void> {
  const [owner, repo] = repoFullName.split('/')

  const { data: prs } = await octokit.pulls.list({
    owner, repo,
    state: 'open',
    per_page: 30,
  })

  for (const pr of prs) {
    const { data: checksResponse } = await octokit.checks.listForRef({
      owner, repo,
      ref: pr.head.sha,
      status: 'completed',
      per_page: 50,
    })

    for (const checkRun of checksResponse.check_runs) {
      const scannerLogin = classifyCheckAsScannerBot(
        checkRun.name,
        checkRun.app?.slug,
        scannerLogins
      )

      if (!scannerLogin) continue

      // Skip if already processed
      const existing = queries.getCheckRunTrigger(repoFullName, checkRun.id)
      if (existing) continue

      await handleScannerCheckCompleted({
        repo: repoFullName,
        prNumber: pr.number,
        checkRunId: checkRun.id,
        checkName: checkRun.name,
        conclusion: checkRun.conclusion ?? 'unknown',
        startedAt: new Date(checkRun.started_at ?? new Date().toISOString()),
        completedAt: new Date(checkRun.completed_at ?? new Date().toISOString()),
        scannerLogin,
      })
    }
  }
}
