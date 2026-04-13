#!/usr/bin/env node

import { execSync } from 'child_process'
import crypto from 'crypto'
import path from 'path'
import os from 'os'
import { Command } from 'commander'
import { initDB, getDB } from './db/index.js'
import * as queries from './db/queries.js'
import { getOctokit } from './github/octokit.js'
import { postPRComment, fetchScannerComments } from './github/client.js'
import { unlinkSession, handleScannerCheckCompleted, handleCIFailure } from './agents/index.js'
import { uninstallHook } from '../scripts/install-hook.js'
import type { CheckRunTriggerRow, LinkedSessionRow } from './db/queries.js'

const DB_PATH = process.env.SENTINEL_DB_PATH ?? path.join(os.homedir(), '.sentinel', 'sentinel.db')

function ensureDB(): void {
  initDB(DB_PATH)
}

function parseRemote(cwd: string): [string, string] {
  const url = execSync('git remote get-url origin', { cwd, encoding: 'utf-8' }).trim()
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/)
  if (!match) throw new Error(`Cannot parse GitHub remote from: ${url}`)
  return [match[1], match[2]]
}

function getCurrentBranch(cwd: string): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim()
}

function detectTmuxPane(): string | null {
  if (!process.env.TMUX) return null
  try {
    return execSync("tmux display-message -p '#S:#I.#P'", { encoding: 'utf-8' }).trim()
  } catch {
    return null
  }
}

async function resolveBranchToPR(cwd: string): Promise<{ repo: string; prNumber: number }> {
  const branch = getCurrentBranch(cwd)
  const [owner, repoName] = parseRemote(cwd)
  const fullName = `${owner}/${repoName}`
  const octokit = getOctokit()

  const { data: prs } = await octokit.pulls.list({
    owner,
    repo: repoName,
    state: 'open',
    head: `${owner}:${branch}`,
  })

  if (prs.length === 0) {
    throw new Error(`No open PR found for branch "${branch}" on ${fullName}`)
  }

  return { repo: fullName, prNumber: prs[0].number }
}

const program = new Command()
program.name('sentinel').description('PR monitor & agent dispatcher CLI').version('0.1.0')

// --- sentinel link ---
program
  .command('link')
  .description('Link current branch to its PR')
  .option('--pr <number>', 'PR number')
  .option('--repo <owner/repo>', 'Repository (owner/repo)')
  .action(async (opts: { pr?: string; repo?: string }) => {
    ensureDB()
    const cwd = process.cwd()

    let repo: string
    let prNumber: number

    if (opts.pr && opts.repo) {
      repo = opts.repo
      prNumber = parseInt(opts.pr, 10)
    } else {
      const detected = await resolveBranchToPR(cwd)
      repo = detected.repo
      prNumber = detected.prNumber
    }

    const tmuxPane = detectTmuxPane()
    const pid = process.ppid

    const sessionId = crypto.createHash('sha256')
      .update(`${repo}:${prNumber}:${pid}:${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    queries.insertLinkedSession({
      id: sessionId,
      repo,
      prNumber,
      agentType: 'claude-code',
      terminalPid: pid,
      tmuxPane,
      repoPath: cwd,
      linkedAt: new Date().toISOString(),
    })

    // Post announcement comment on the PR
    const [owner, repoName] = repo.split('/')
    const octokit = getOctokit()
    const userLabel = process.env.SENTINEL_USER_LABEL ?? process.env.GITHUB_USERNAME ?? ''
    const result = await postPRComment(
      owner, repoName, prNumber,
      `**Sentinel** linked an agent session to this PR${userLabel ? ` (${userLabel})` : ''}.`,
      octokit
    )

    if (result?.id) {
      queries.updateLinkedSessionCommentId(sessionId, result.id)
    }

    console.log(`\u2713 Linked PR #${prNumber} (${repo}) to this session`)
  })

// --- sentinel unlink ---
program
  .command('unlink')
  .description('Detach current session from its PR')
  .action(async () => {
    ensureDB()
    const cwd = process.cwd()
    const { repo, prNumber } = await resolveBranchToPR(cwd)
    await unlinkSession(repo, prNumber, 'manual')
    console.log(`\u2713 Unlinked PR #${prNumber}`)
  })

// --- sentinel status ---
program
  .command('status')
  .description('Show active links and PR health')
  .action(async () => {
    ensureDB()
    const sessions = queries.getActiveLinkedSessions()
    const db = getDB()

    // Get recent check_run_triggers
    const recentTriggers = db.prepare(
      'SELECT * FROM check_run_triggers ORDER BY completed_at DESC LIMIT 10'
    ).all() as CheckRunTriggerRow[]

    // Get watched repos
    const watchedRepos = db.prepare(
      'SELECT * FROM watched_repos WHERE active = 1'
    ).all() as Array<{ full_name: string; last_polled: string | null }>

    if (sessions.length === 0 && recentTriggers.length === 0 && watchedRepos.length === 0) {
      console.log('No active sessions, recent triggers, or watched repos.')
      return
    }

    if (sessions.length > 0) {
      console.log('\nActive Sessions:')
      const header = 'Repo'.padEnd(30) + 'PR'.padEnd(10) + 'Agent'.padEnd(16) + 'Linked At'
      console.log(header)
      console.log('-'.repeat(80))
      for (const s of sessions) {
        const line = s.repo.padEnd(30) + `#${s.pr_number}`.padEnd(10) + s.agent_type.padEnd(16) + s.linked_at
        console.log(line)
      }
    }

    if (recentTriggers.length > 0) {
      console.log('\nRecent Check Run Triggers:')
      const header = 'Repo'.padEnd(30) + 'PR'.padEnd(10) + 'Check'.padEnd(22) + 'Conclusion'
      console.log(header)
      console.log('-'.repeat(80))
      for (const t of recentTriggers) {
        const line = t.repo.padEnd(30) + `#${t.pr_number}`.padEnd(10) + t.check_name.padEnd(22) + t.conclusion
        console.log(line)
      }
    }

    if (watchedRepos.length > 0) {
      console.log('\nWatched Repos:')
      const header = 'Repo'.padEnd(40) + 'Last Polled'
      console.log(header)
      console.log('-'.repeat(60))
      for (const r of watchedRepos) {
        const line = r.full_name.padEnd(40) + (r.last_polled ?? 'never')
        console.log(line)
      }
    }
  })

// --- sentinel flush ---
program
  .command('flush')
  .description('Re-fetch and re-dispatch for a PR')
  .requiredOption('--pr <number>', 'PR number')
  .action(async (opts: { pr: string }) => {
    ensureDB()
    const prNumber = parseInt(opts.pr, 10)

    // Find the most recent check_run_trigger for this PR
    const db = getDB()
    const trigger = db.prepare(
      'SELECT * FROM check_run_triggers WHERE pr_number = ? ORDER BY completed_at DESC LIMIT 1'
    ).get(prNumber) as CheckRunTriggerRow | undefined

    if (!trigger) {
      console.error(`No check run trigger found for PR #${prNumber}`)
      process.exit(1)
    }

    const scannerLogins = (process.env.SCANNER_BOT_LOGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const scannerLogin = scannerLogins.find(l =>
      l.toLowerCase().includes(trigger.check_name.toLowerCase())
    ) ?? scannerLogins[0]

    if (!scannerLogin) {
      console.error('No scanner bot logins configured in SCANNER_BOT_LOGINS')
      process.exit(1)
    }

    // Re-fetch scanner comments from GitHub
    const octokit = getOctokit()
    const events = await fetchScannerComments(
      octokit,
      trigger.repo,
      prNumber,
      scannerLogin,
      new Date(trigger.started_at),
      { prTitle: '', prUrl: `https://github.com/${trigger.repo}/pull/${prNumber}` }
    )

    // Re-dispatch via handleScannerCheckCompleted
    await handleScannerCheckCompleted({
      repo: trigger.repo,
      prNumber,
      checkRunId: trigger.check_run_id + 1, // synthetic ID to avoid dedup
      checkName: trigger.check_name,
      conclusion: trigger.conclusion,
      startedAt: new Date(trigger.started_at),
      completedAt: new Date(),
      scannerLogin,
    })

    console.log(`\u2713 Flushed PR #${prNumber} \u2014 dispatched ${events.length} issues`)
  })

// --- sentinel test-webhook ---
program
  .command('test-webhook')
  .description('Fire a fake payload for local dev')
  .requiredOption('--pr <number>', 'PR number')
  .requiredOption('--type <type>', 'Webhook type: bugbot|codeql|ci|success')
  .action(async (opts: { pr: string; type: string }) => {
    ensureDB()
    const prNumber = parseInt(opts.pr, 10)
    const type = opts.type

    if (!['bugbot', 'codeql', 'ci', 'success'].includes(type)) {
      console.error('Invalid type. Must be one of: bugbot, codeql, ci, success')
      process.exit(1)
    }

    if (type === 'bugbot' || type === 'codeql') {
      const scannerLogin = type === 'bugbot' ? 'bugbot[bot]' : 'github-advanced-security[bot]'
      const checkName = type === 'bugbot' ? 'BugBot Scan' : 'CodeQL'
      const now = new Date()

      // Mock 3 fake scanner comments — bypass HTTP layer entirely
      const fakeEvents = [1, 2, 3].map(i => ({
        id: crypto.createHash('sha256').update(`test:${type}:${prNumber}:${i}:${Date.now()}`).digest('hex'),
        repo: 'test/repo',
        prNumber,
        prTitle: `Test PR #${prNumber}`,
        prUrl: `https://github.com/test/repo/pull/${prNumber}`,
        prAuthor: 'test-user',
        eventType: 'comment' as const,
        source: type as 'bugbot' | 'codeql',
        actor: scannerLogin,
        body: `Fake ${type} issue #${i}: potential vulnerability detected in test file`,
        githubUrl: `https://github.com/test/repo/pull/${prNumber}#issuecomment-${i}`,
        receivedAt: now,
      }))

      // Insert events directly
      for (const event of fakeEvents) {
        queries.insertEvent(event)
      }

      // Record trigger and health
      queries.insertCheckRunTrigger({
        repo: 'test/repo',
        prNumber,
        checkRunId: Date.now(),
        checkName,
        conclusion: 'action_required',
        startedAt: now,
        completedAt: now,
      })

      queries.upsertPRHealth({
        repo: 'test/repo',
        prNumber,
        checkName,
        conclusion: 'action_required',
        lastRunAt: now,
      })

      // Dispatch directly — call handleScannerCheckCompleted which will
      // hit the real Octokit (returning empty), but events are already in DB
      const batch = { repo: 'test/repo', prNumber, events: fakeEvents }
      const prMeta = { prTitle: `Test PR #${prNumber}`, prUrl: `https://github.com/test/repo/pull/${prNumber}` }

      const linkedSession = queries.getLinkedSession('test/repo', prNumber)
      if (linkedSession && !linkedSession.unlinked_at) {
        const { injectIntoSession } = await import('./agents/inject.js')
        await injectIntoSession(linkedSession, batch, prMeta)
      } else {
        const { sendBatchNotification } = await import('./notifications/index.js')
        await sendBatchNotification(batch, prMeta)
      }

      console.log(`\u2713 Test webhook fired \u2014 type: ${type}, PR: #${prNumber}`)
    } else if (type === 'ci') {
      await handleCIFailure({
        repo: 'test/repo',
        prNumber,
        checkRun: {
          id: Date.now(),
          name: 'test-ci-run',
          conclusion: 'failure',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
      })

      console.log(`\u2713 Test webhook fired \u2014 type: ${type}, PR: #${prNumber}`)
    } else if (type === 'success') {
      await handleScannerCheckCompleted({
        repo: 'test/repo',
        prNumber,
        checkRunId: Date.now(),
        checkName: 'BugBot Scan',
        conclusion: 'success',
        startedAt: new Date(),
        completedAt: new Date(),
        scannerLogin: 'bugbot[bot]',
      })

      console.log(`\u2713 Test webhook fired \u2014 type: ${type}, PR: #${prNumber}`)
    }
  })

// --- sentinel uninstall ---
program
  .command('uninstall')
  .description('Remove Claude Code hook')
  .action(async () => {
    await uninstallHook()
    console.log('\u2713 Sentinel hook removed from ~/.claude/settings.json')
  })

program.parse()
