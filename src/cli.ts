#!/usr/bin/env node

import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

// Load .env from sentinel's install directory, not cwd
const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.resolve(__dirname, '..', '.env') })

import crypto from 'crypto'
import os from 'os'
import { execSync } from 'child_process'
import { initDB } from './db/index.js'
import * as queries from './db/queries.js'
import { getOctokit } from './github/octokit.js'
import { resolveBranchToPR, getCurrentBranch, parseRemote } from './github/repos.js'
import { handleScannerCheckCompleted, unlinkSession } from './agents/index.js'
import { uninstallHook } from '../scripts/install-hook.js'

const DB_PATH =
  process.env.SENTINEL_DB_PATH ?? path.join(os.homedir(), '.sentinel', 'sentinel.db')

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
  const { pid: terminalPid, tty } = resolveTerminalContext()

  queries.insertLinkedSession({
    id: sessionId,
    repo,
    prNumber,
    agentType: 'claude-code',
    terminalPid,
    tty,
    tmuxPane: process.env.SENTINEL_DEFAULT_TMUX_PANE ?? null,
    repoPath: cwd,
    linkedAt: new Date().toISOString(),
  })

  console.log(`Linked: ${repo}#${prNumber} (session ${sessionId}, pid ${terminalPid ?? '-'}, tty ${tty ?? '-'})`)
}

function resolveTerminalContext(): { pid: number | null; tty: string | null } {
  // Start from our parent (we ourselves exit right after), then walk up the
  // process tree until we find a live ancestor with a real controlling tty.
  // That ancestor is long-lived (zsh, Claude Code, iTerm2) and its tty is
  // the iTerm tab's tty. Storing both pins aliveness *and* routing to the
  // same process, so the daemon's pid-watcher doesn't auto-unlink when a
  // short-lived bash (spawned by Claude's `!`) exits.
  const start = process.ppid ?? null
  if (!start) return { pid: null, tty: null }
  let pid: number = start
  for (let hops = 0; hops < 20; hops++) {
    const tty = ttyForPid(pid)
    if (tty) return { pid, tty }
    const ppid = parentPid(pid)
    if (!ppid || ppid === pid || ppid <= 1) return { pid: null, tty: null }
    pid = ppid
  }
  return { pid: null, tty: null }
}

function ttyForPid(pid: number): string | null {
  try {
    const raw = execSync(`ps -o tty= -p ${pid}`, { encoding: 'utf-8' }).trim()
    if (!raw || raw === '?' || raw === '??') return null
    return raw.startsWith('/dev/') ? raw : `/dev/${raw}`
  } catch {
    return null
  }
}

function parentPid(pid: number): number | null {
  try {
    const raw = execSync(`ps -o ppid= -p ${pid}`, { encoding: 'utf-8' }).trim()
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
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
    // Simulate all checks passing — mark everything green
    queries.upsertPRHealth({ repo, prNumber, checkName: 'BugBot', conclusion: 'success', lastRunAt: now })
    queries.upsertPRHealth({ repo, prNumber, checkName: 'CI', conclusion: 'success', lastRunAt: now })

    // Mark any existing scanner events as reviewed so isPRGreen returns true
    const openEvents = queries.getUnreviewedScannerEvents(repo, prNumber)
    for (const e of openEvents) queries.markEventReviewed(e.id)

    const { isPRGreen, handlePRGreen } = await import('./agents/index.js')
    if (await isPRGreen(repo, prNumber)) {
      await handlePRGreen(repo, prNumber, `https://github.com/${repo}/pull/${prNumber}`)
      console.log(`Simulated: all checks passing for ${repo}#${prNumber} — green state fired`)
    } else {
      console.log(`Simulated: checks marked as passing for ${repo}#${prNumber} but PR not fully green yet`)
    }
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

    // Record a check_run_trigger and pr_health entry
    const checkRunId = Math.floor(Math.random() * 100000)
    queries.insertCheckRunTrigger({
      repo, prNumber, checkRunId,
      checkName: typeFlag === 'bugbot' ? 'BugBot Scan' : 'CodeQL',
      conclusion: 'action_required',
      startedAt: fiveMinAgo, completedAt: now,
    })
    queries.upsertPRHealth({
      repo, prNumber,
      checkName: typeFlag === 'bugbot' ? 'BugBot Scan' : 'CodeQL',
      conclusion: 'action_required', lastRunAt: now,
    })

    // Send notification and inject directly — skip GitHub API fetch
    const { sendBatchNotification } = await import('./notifications/index.js')
    const { injectIntoSession } = await import('./agents/inject.js')
    const { buildBatchPrompt } = await import('./agents/prompts.js')

    const batch = { repo, prNumber, events: fakeEvents }
    const prMeta = { prTitle: `Test PR #${prNumber}`, prUrl: `https://github.com/${repo}/pull/${prNumber}` }

    const linkedSession = queries.getLinkedSession(repo, prNumber)
    if (linkedSession && !linkedSession.unlinked_at) {
      const prompt = buildBatchPrompt(batch, prMeta.prTitle, prMeta.prUrl)
      await injectIntoSession(linkedSession, batch, prMeta, prompt)
      console.log(`Simulated: 3 ${typeFlag} issues on ${repo}#${prNumber} — injected into linked session`)
    } else {
      await sendBatchNotification(batch, prMeta)
      console.log(`Simulated: 3 ${typeFlag} issues on ${repo}#${prNumber} — notification sent`)
    }
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

async function cmdTui(): Promise<void> {
  const { spawn } = await import('child_process')
  const sentinelDir = path.resolve(__dirname, '..')
  const binary = path.join(sentinelDir, 'tui', 'target', 'release', 'sentinel-tui')
  const fs = await import('fs')
  if (!fs.existsSync(binary)) {
    console.error(`sentinel-tui binary not found at ${binary}`)
    console.error('Build it with:  cd tui && cargo build --release')
    process.exit(1)
  }
  const child = spawn(binary, [], { stdio: 'inherit' })
  await new Promise<void>((resolve) => {
    child.on('exit', (code) => {
      if (code && code !== 0) process.exit(code)
      resolve()
    })
  })
}

function launchdLabel(): string {
  return 'com.sentinel.daemon'
}

async function cmdStart(): Promise<void> {
  const { execSync } = await import('child_process')
  try {
    execSync(`launchctl kickstart gui/$(id -u)/${launchdLabel()}`, { stdio: 'inherit' })
    console.log('Sentinel daemon started.')
  } catch {
    const plist = `${process.env.HOME}/Library/LaunchAgents/${launchdLabel()}.plist`
    execSync(`launchctl load ${plist}`, { stdio: 'inherit' })
    console.log('Sentinel daemon loaded.')
  }
}

async function cmdStop(): Promise<void> {
  const { execSync } = await import('child_process')
  const plist = `${process.env.HOME}/Library/LaunchAgents/${launchdLabel()}.plist`
  execSync(`launchctl unload ${plist}`, { stdio: 'inherit' })
  console.log('Sentinel daemon stopped.')
}

async function cmdRestart(): Promise<void> {
  const { execSync } = await import('child_process')
  execSync(`launchctl kickstart -k gui/$(id -u)/${launchdLabel()}`, { stdio: 'inherit' })
  console.log('Sentinel daemon restarted.')
}

async function cmdLogs(): Promise<void> {
  const { spawn } = await import('child_process')
  const logPath = `${process.env.HOME}/.sentinel/sentinel.log`
  const errPath = `${process.env.HOME}/.sentinel/sentinel.error.log`
  const child = spawn('tail', ['-f', logPath, errPath], { stdio: 'inherit' })
  await new Promise<void>((resolve) => child.on('exit', () => resolve()))
}

async function cmdWebhooks(): Promise<void> {
  const rotate = args.includes('--rotate-smee')
  const sentinelDir = path.resolve(__dirname, '..')
  const envPath = path.join(sentinelDir, '.env')

  let smeeUrl = process.env.SMEE_URL ?? ''
  const pat = process.env.GITHUB_PAT ?? ''
  const secret = process.env.WEBHOOK_SECRET ?? ''
  const org = process.env.GITHUB_ORG ?? ''

  if (!pat || !secret || !org) {
    console.error('Missing config. Ensure GITHUB_PAT, WEBHOOK_SECRET, and GITHUB_ORG are set in .env.')
    process.exit(1)
  }

  if (rotate || !smeeUrl) {
    smeeUrl = await generateSmeeUrl()
    await writeEnvUpdate(envPath, 'SMEE_URL', smeeUrl)
    console.log(`Generated new smee channel: ${smeeUrl}`)
    console.log('Restarting daemon so smee-client reconnects to the new URL...')
    try {
      execSync(`launchctl kickstart -k gui/$(id -u)/com.sentinel.daemon`, { stdio: 'ignore' })
    } catch {
      console.warn('Could not restart the daemon automatically — restart it manually.')
    }
  }

  const { setupWebhooks } = await import('../scripts/setup-webhook.js')
  const result = await setupWebhooks({
    webhookUrl: smeeUrl,
    org,
    secret,
    pat,
    updateExisting: rotate,
  })

  console.log('')
  console.log(`Summary: ${result.created.length} created, ${result.updated.length} updated, ${result.skipped.length} skipped, ${result.errors.length} errored`)
  if (result.errors.length > 0) {
    console.log('Errors:')
    for (const e of result.errors) console.log(`  ${e.repo}: ${e.message}`)
  }
}

async function generateSmeeUrl(): Promise<string> {
  // smee.io returns the new channel URL as the Location header on a redirect.
  const res = await fetch('https://smee.io/new', { redirect: 'manual' })
  const loc = res.headers.get('location')
  if (!loc) throw new Error(`smee.io did not return a redirect (status ${res.status})`)
  return loc.startsWith('http') ? loc : `https://smee.io${loc}`
}

async function writeEnvUpdate(envPath: string, key: string, value: string): Promise<void> {
  const fs = await import('fs/promises')
  let content = ''
  try {
    content = await fs.readFile(envPath, 'utf-8')
  } catch {
    // new file
  }
  const line = `${key}=${value}`
  if (new RegExp(`^${key}=`, 'm').test(content)) {
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), line)
  } else {
    content = content + (content.endsWith('\n') || content.length === 0 ? '' : '\n') + line + '\n'
  }
  await fs.writeFile(envPath, content, 'utf-8')
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
    case 'tui':
      await cmdTui()
      break
    case 'start':
      await cmdStart()
      break
    case 'stop':
      await cmdStop()
      break
    case 'restart':
      await cmdRestart()
      break
    case 'logs':
      await cmdLogs()
      break
    case 'webhooks':
      await cmdWebhooks()
      break
    default:
      console.log('Usage: sentinel <command>')
      console.log('')
      console.log('Linking:')
      console.log('  link                          Link current branch to its PR')
      console.log('  link --pr <n> --repo <o/r>    Explicit link')
      console.log('  unlink                        Detach current session')
      console.log('  status                        Show active links and PR health')
      console.log('')
      console.log('Service:')
      console.log('  tui                           Open the interactive dashboard')
      console.log('  start | stop | restart        Control the launchd daemon')
      console.log('  logs                          Tail ~/.sentinel/*.log')
      console.log('  webhooks [--rotate-smee]      Register GitHub webhooks from .env')
      console.log('')
      console.log('Ops:')
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
