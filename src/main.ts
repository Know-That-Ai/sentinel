import 'dotenv/config'
import { execSync } from 'child_process'
import path from 'path'
import os from 'os'
import { initDB } from './db/index.js'
import { createApp } from './server/index.js'
import * as queries from './db/queries.js'
import { getOctokit } from './github/octokit.js'

const PORT = parseInt(process.env.PORT ?? '3847', 10)
const DB_PATH = process.env.SENTINEL_DB_PATH ?? path.join(os.homedir(), '.sentinel', 'sentinel.db')

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

function parseRemote(repoPath: string): [string, string] {
  const url = execSync('git remote get-url origin', { cwd: repoPath, encoding: 'utf-8' }).trim()
  // Handle SSH (git@github.com:owner/repo.git) and HTTPS (https://github.com/owner/repo.git)
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (!match) throw new Error(`Cannot parse GitHub remote from: ${url}`)
  return [match[1], match[2]]
}

async function autoDetectSessions(): Promise<void> {
  setInterval(async () => {
    try {
      // Find running claude processes
      const psOutput = execSync("ps aux | grep -E '[c]laude' || true", { encoding: 'utf-8' }).trim()
      if (!psOutput) return

      const lines = psOutput.split('\n').filter(Boolean)
      const octokit = getOctokit()

      for (const line of lines) {
        const parts = line.split(/\s+/)
        const pid = parseInt(parts[1], 10)
        if (!pid || isNaN(pid)) continue

        // Try to get the cwd of the process
        let cwd: string
        try {
          cwd = execSync(`lsof -p ${pid} -Fn | grep '^n/' | grep 'cwd' || lsof -p ${pid} -Fn 2>/dev/null | head -3 | tail -1 | sed 's/^n//'`, {
            encoding: 'utf-8',
          }).trim()
          if (!cwd || !cwd.startsWith('/')) {
            // Fallback: try /proc-style on macOS
            cwd = execSync(`pwdx ${pid} 2>/dev/null | awk '{print $2}' || true`, { encoding: 'utf-8' }).trim()
          }
          if (!cwd || !cwd.startsWith('/')) continue
        } catch {
          continue
        }

        // Check if it's a git repo
        let branch: string
        try {
          branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim()
        } catch {
          continue
        }

        // Try to resolve to a PR
        let owner: string, repo: string
        try {
          [owner, repo] = parseRemote(cwd)
        } catch {
          continue
        }

        const fullName = `${owner}/${repo}`

        // Check if already linked
        const existing = queries.getLinkedSession(fullName, 0)
        if (existing && !existing.unlinked_at) continue

        // Check for open PR on this branch
        try {
          const { data: prs } = await octokit.pulls.list({
            owner,
            repo,
            state: 'open',
            head: `${owner}:${branch}`,
          })

          if (prs.length === 0) continue

          const pr = prs[0]

          // Check if already linked for this specific PR
          const existingForPR = queries.getLinkedSession(fullName, pr.number)
          if (existingForPR && !existingForPR.unlinked_at) continue

          const crypto = await import('crypto')
          const sessionId = crypto.createHash('sha256')
            .update(`${fullName}:${pr.number}:${pid}:${Date.now()}`)
            .digest('hex')
            .slice(0, 16)

          queries.insertLinkedSession({
            id: sessionId,
            repo: fullName,
            prNumber: pr.number,
            agentType: 'claude-code',
            terminalPid: pid,
            tmuxPane: null,
            repoPath: cwd,
            linkedAt: new Date().toISOString(),
          })
        } catch {
          // GitHub API call failed — skip this process
          continue
        }
      }
    } catch {
      // ps or other system call failed — skip this cycle
    }
  }, 60_000)
}

async function main(): Promise<void> {
  initDB(DB_PATH)

  const app = createApp()
  app.listen(PORT, () => {
    console.log(`Sentinel daemon started on port ${PORT}`)
  })

  await watchLinkedSessions()
  await autoDetectSessions()
}

main().catch((err) => {
  console.error('Sentinel failed to start:', err)
  process.exit(1)
})
