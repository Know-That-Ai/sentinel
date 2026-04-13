#!/usr/bin/env node

import crypto from 'crypto'
import { initDB } from './db/index.js'
import * as queries from './db/queries.js'
import { getOctokit } from './github/octokit.js'
import { resolveBranchToPR, getCurrentBranch, parseRemote } from './github/repos.js'
import { handleScannerCheckCompleted, unlinkSession } from './agents/index.js'
import { uninstallHook } from '../scripts/install-hook.js'

const DB_PATH = process.env.SENTINEL_DB_PATH ?? 'sentinel.db'

const command = process.argv[2]
const args = process.argv.slice(3)

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined
}

async function cmdLink(): Promise<void> {
  initDB(DB_PATH)

  const prFlag = parseFlag('--pr')
  const repoFlag = parseFlag('--repo')
  const cwd = process.cwd()

  let repo: string
  let prNumber: number

  if (prFlag && repoFlag) {
    repo = repoFlag
    prNumber = parseInt(prFlag, 10)
  } else {
    const octokit = getOctokit()
    const resolved = await resolveBranchToPR(cwd, octokit)
    if (!resolved) {
      console.error('No open PR found for the current branch.')
      process.exit(1)
    }
    repo = resolved.repo
    prNumber = resolved.prNumber
  }

  // Check for existing active link
  const existing = queries.getLinkedSession(repo, prNumber)
  if (existing && !existing.unlinked_at) {
    console.log(`Already linked: ${repo}#${prNumber} (session ${existing.id})`)
    return
  }

  const sessionId = crypto.randomUUID()
  const terminalPid = process.ppid ?? null

  queries.insertLinkedSession({
    id: sessionId,
    repo,
    prNumber,
    agentType: 'claude-code',
    terminalPid,
    tmuxPane: process.env.SENTINEL_DEFAULT_TMUX_PANE ?? null,
    repoPath: cwd,
    linkedAt: new Date().toISOString(),
  })

  console.log(`Linked: ${repo}#${prNumber} (session ${sessionId}, pid ${terminalPid})`)
}

async function cmdUnlink(): Promise<void> {
  initDB(DB_PATH)

  const cwd = process.cwd()
  let repo: string
  let prNumber: number | null = null

  try {
    const [owner, repoName] = parseRemote(cwd)
    repo = `${owner}/${repoName}`

    // Find active session for this repo
    const sessions = queries.getActiveLinkedSessions()
    const session = sessions.find(s => s.repo === repo)
    if (!session) {
      console.log('No active linked session found for this repo.')
      return
    }
    prNumber = session.pr_number
  } catch {
    console.error('Could not determine repo from current directory.')
    process.exit(1)
  }

  await unlinkSession(repo, prNumber!, 'manual')
  console.log(`Unlinked: ${repo}#${prNumber}`)
}

async function cmdStatus(): Promise<void> {
  initDB(DB_PATH)

  const sessions = queries.getActiveLinkedSessions()
  if (sessions.length === 0) {
    console.log('No active linked sessions.')
  } else {
    console.log('Active linked sessions:')
    for (const s of sessions) {
      console.log(`  ${s.repo}#${s.pr_number}  agent=${s.agent_type}  pid=${s.terminal_pid ?? '-'}  since ${s.linked_at}`)
    }
  }

  console.log('')

  // Show recent PR health
  const recentEvents = queries.getUnreviewedEvents()
  if (recentEvents.length === 0) {
    console.log('No unreviewed events.')
  } else {
    console.log(`${recentEvents.length} unreviewed event(s):`)
    for (const e of recentEvents.slice(0, 10)) {
      console.log(`  [${e.source}] ${e.repo}#${e.pr_number}: ${(e.body ?? e.actor).slice(0, 80)}`)
    }
    if (recentEvents.length > 10) {
      console.log(`  ... and ${recentEvents.length - 10} more`)
    }
  }
}

async function cmdFlush(): Promise<void> {
  initDB(DB_PATH)

  const prFlag = parseFlag('--pr')
  if (!prFlag) {
    console.error('Usage: sentinel flush --pr <number>')
    process.exit(1)
  }

  const prNumber = parseInt(prFlag, 10)
  const cwd = process.cwd()
  const [owner, repoName] = parseRemote(cwd)
  const repo = `${owner}/${repoName}`

  const octokit = getOctokit()

  // Fetch latest check runs for the PR
  const { data: pr } = await octokit.pulls.get({ owner, repo: repoName, pull_number: prNumber })
  const { data: checksResponse } = await octokit.checks.listForRef({
    owner, repo: repoName,
    ref: pr.head.sha,
    status: 'completed',
    per_page: 50,
  })

  const scannerLogins = (process.env.SCANNER_BOT_LOGINS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)

  const { classifyCheckAsScannerBot } = await import('./github/events.js')

  let dispatched = 0
  for (const cr of checksResponse.check_runs) {
    const scannerLogin = classifyCheckAsScannerBot(cr.name, cr.app?.slug, scannerLogins)
    if (!scannerLogin) continue

    await handleScannerCheckCompleted({
      repo,
      prNumber,
      checkRunId: cr.id,
      checkName: cr.name,
      conclusion: cr.conclusion ?? 'unknown',
      startedAt: new Date(cr.started_at ?? new Date().toISOString()),
      completedAt: new Date(cr.completed_at ?? new Date().toISOString()),
      scannerLogin,
    })
    dispatched++
  }

  console.log(`Flushed: re-dispatched ${dispatched} scanner check run(s) for ${repo}#${prNumber}`)
}

async function cmdTestWebhook(): Promise<void> {
  initDB(DB_PATH)

  const prFlag = parseFlag('--pr')
  const typeFlag = parseFlag('--type')

  if (!prFlag || !typeFlag) {
    console.error('Usage: sentinel test-webhook --pr <number> --type <bugbot|codeql|ci|success>')
    process.exit(1)
  }

  const prNumber = parseInt(prFlag, 10)
  const cwd = process.cwd()
  const [owner, repoName] = parseRemote(cwd)
  const repo = `${owner}/${repoName}`

  const now = new Date()
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000)

  if (typeFlag === 'success') {
    // Simulate all checks passing
    queries.upsertPRHealth({ repo, prNumber, checkName: 'BugBot', conclusion: 'success', lastRunAt: now })
    queries.upsertPRHealth({ repo, prNumber, checkName: 'CI', conclusion: 'success', lastRunAt: now })

    await handleScannerCheckCompleted({
      repo, prNumber,
      checkRunId: Math.floor(Math.random() * 100000),
      checkName: 'BugBot',
      conclusion: 'success',
      startedAt: fiveMinAgo,
      completedAt: now,
      scannerLogin: 'cursor-bugbot[bot]',
    })

    console.log(`Simulated: all checks passing for ${repo}#${prNumber} — green state should fire`)
    return
  }

  const scannerLogin = typeFlag === 'codeql'
    ? 'github-advanced-security[bot]'
    : 'cursor-bugbot[bot]'

  if (typeFlag === 'bugbot' || typeFlag === 'codeql') {
    // Insert fake scanner events
    const fakeEvents = [
      {
        id: crypto.randomUUID(),
        repo, prNumber,
        prTitle: `Test PR #${prNumber}`,
        prUrl: `https://github.com/${repo}/pull/${prNumber}`,
        prAuthor: 'test-user',
        eventType: 'comment' as const,
        source: (typeFlag === 'bugbot' ? 'bugbot' : 'codeql') as const,
        actor: scannerLogin,
        body: `[TEST] Potential null dereference at line ${Math.floor(Math.random() * 200)}`,
        githubUrl: `https://github.com/${repo}/pull/${prNumber}#issuecomment-fake`,
        receivedAt: now,
      },
      {
        id: crypto.randomUUID(),
        repo, prNumber,
        prTitle: `Test PR #${prNumber}`,
        prUrl: `https://github.com/${repo}/pull/${prNumber}`,
        prAuthor: 'test-user',
        eventType: 'comment' as const,
        source: (typeFlag === 'bugbot' ? 'bugbot' : 'codeql') as const,
        actor: scannerLogin,
        body: `[TEST] Unused variable in scope — consider removing`,
        githubUrl: `https://github.com/${repo}/pull/${prNumber}#issuecomment-fake-2`,
        receivedAt: now,
      },
      {
        id: crypto.randomUUID(),
        repo, prNumber,
        prTitle: `Test PR #${prNumber}`,
        prUrl: `https://github.com/${repo}/pull/${prNumber}`,
        prAuthor: 'test-user',
        eventType: 'comment' as const,
        source: (typeFlag === 'bugbot' ? 'bugbot' : 'codeql') as const,
        actor: scannerLogin,
        body: `[TEST] Possible SQL injection in query builder`,
        githubUrl: `https://github.com/${repo}/pull/${prNumber}#issuecomment-fake-3`,
        receivedAt: now,
      },
    ]

    for (const e of fakeEvents) queries.insertEvent(e)

    // Trigger the scanner check completed flow with action_required so it dispatches
    await handleScannerCheckCompleted({
      repo, prNumber,
      checkRunId: Math.floor(Math.random() * 100000),
      checkName: typeFlag === 'bugbot' ? 'BugBot Scan' : 'CodeQL',
      conclusion: 'action_required',
      startedAt: fiveMinAgo,
      completedAt: now,
      scannerLogin,
    })

    console.log(`Simulated: 3 ${typeFlag} issues on ${repo}#${prNumber}`)
  } else if (typeFlag === 'ci') {
    const { handleCIFailure } = await import('./agents/index.js')
    await handleCIFailure({
      repo, prNumber,
      checkRun: {
        id: Math.floor(Math.random() * 100000),
        name: 'run-tests',
        conclusion: 'failure',
        started_at: fiveMinAgo.toISOString(),
        completed_at: now.toISOString(),
      },
    })

    console.log(`Simulated: CI failure on ${repo}#${prNumber}`)
  } else {
    console.error(`Unknown type: ${typeFlag}. Use: bugbot, codeql, ci, or success`)
    process.exit(1)
  }
}

async function cmdUninstall(): Promise<void> {
  const settingsPath = `${process.env.HOME}/.claude/settings.json`
  await uninstallHook(settingsPath)
  console.log('Sentinel hook removed from Claude Code settings.')
}

async function main(): Promise<void> {
  switch (command) {
    case 'link':
      await cmdLink()
      break
    case 'unlink':
      await cmdUnlink()
      break
    case 'status':
      await cmdStatus()
      break
    case 'flush':
      await cmdFlush()
      break
    case 'test-webhook':
      await cmdTestWebhook()
      break
    case 'uninstall':
      await cmdUninstall()
      break
    default:
      console.log('Usage: sentinel <link|unlink|status|flush|test-webhook|uninstall>')
      console.log('')
      console.log('Commands:')
      console.log('  link                          Link current branch to its PR')
      console.log('  link --pr <n> --repo <o/r>    Explicit link')
      console.log('  unlink                        Detach current session')
      console.log('  status                        Show active links and PR health')
      console.log('  flush --pr <n>                Re-fetch and re-dispatch for a PR')
      console.log('  test-webhook --pr <n> --type <bugbot|codeql|ci|success>')
      console.log('  uninstall                     Remove Claude Code hook')
      process.exit(command ? 1 : 0)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
