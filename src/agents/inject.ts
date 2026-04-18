import fs from 'fs/promises'
import path from 'path'
import { execSync, spawnSync } from 'child_process'
import { buildBatchPrompt } from './prompts.js'
import type { EventBatch, PRMeta } from '../github/events.js'
import type { LinkedSessionRow } from '../db/queries.js'

export async function injectIntoSession(
  session: LinkedSessionRow,
  batch: EventBatch,
  prMeta: PRMeta,
  promptOverride?: string
): Promise<void> {
  const prompt = promptOverride ?? buildBatchPrompt(
    batch,
    prMeta.prTitle,
    `https://github.com/${batch.repo}/pull/${batch.prNumber}`
  )

  const inboxDir = path.join(session.repo_path, '.sentinel', 'inbox')
  await fs.mkdir(inboxDir, { recursive: true })
  const inboxFile = path.join(inboxDir, `${batch.prNumber}.md`)
  await fs.writeFile(inboxFile, prompt, 'utf-8')

  await ensureGitignore(session.repo_path, '.sentinel/')

  // What gets TYPED into the terminal is a short one-liner. The full
  // multi-line prompt lives on disk. Without this split, each newline in
  // the prompt would be typed as Enter and Claude would submit fragments.
  const trigger = buildTriggerMessage(batch)

  if (session.tmux_pane) {
    const delivered = await tryDeliverViaTmux(session.tmux_pane, trigger)
    if (delivered) return
    // Pane is stale / tmux unreachable — fall through to osascript.
  }

  const tty = resolveTty(session)
  if (tty) {
    await deliverViaOsascript(tty, trigger)
  }
  // If no tty resolvable, inbox file is still written — Claude can read it.
}

function buildTriggerMessage(batch: EventBatch): string {
  const n = batch.events.length
  const sources = [...new Set(batch.events.map((e) => e.source))].join(', ')
  return (
    `Sentinel: ${n} ${sources} issue${n > 1 ? 's' : ''} on PR #${batch.prNumber} — ` +
    `read .sentinel/inbox/${batch.prNumber}.md and address per the instructions in that file.`
  )
}

async function ensureGitignore(repoPath: string, entry: string): Promise<void> {
  const gitignorePath = path.join(repoPath, '.gitignore')
  let content = ''
  try {
    content = await fs.readFile(gitignorePath, 'utf-8')
  } catch {
    // .gitignore doesn't exist yet
  }

  if (!content.includes(entry)) {
    const newContent = content ? `${content}\n${entry}\n` : `${entry}\n`
    await fs.writeFile(gitignorePath, newContent, 'utf-8')
  }
}

async function tryDeliverViaTmux(pane: string, prompt: string): Promise<boolean> {
  try {
    // Fail fast if the pane isn't actually live (wrong target, tmux server
    // down, tmux not installed) instead of sending keys into nothing.
    execSync(`tmux has-session -t ${JSON.stringify(pane.split('.')[0])}`, {
      stdio: 'ignore',
    })
    execSync(`tmux display-message -t ${JSON.stringify(pane)} -p '#{pane_id}'`, {
      stdio: 'ignore',
    })
  } catch {
    return false
  }
  try {
    const escaped = prompt.replace(/'/g, `'"'"'`)
    execSync(`tmux send-keys -t '${pane}' '' Enter`, { stdio: 'ignore' })
    execSync(`tmux send-keys -t '${pane}' '${escaped}' Enter`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function resolveTty(session: LinkedSessionRow): string | null {
  if (session.tty) return session.tty
  if (!session.terminal_pid) return null
  return ttyOfAncestor(session.terminal_pid)
}

function ttyOfAncestor(startPid: number): string | null {
  let pid = startPid
  for (let hops = 0; hops < 20; hops++) {
    const tty = ttyForPid(pid)
    if (tty) return tty
    const ppid = parentPid(pid)
    if (!ppid || ppid === pid || ppid <= 1) return null
    pid = ppid
  }
  return null
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

async function deliverViaOsascript(tty: string, message: string): Promise<void> {
  // Each inject* script asks System Events whether the terminal app is
  // running before doing anything — so we won't accidentally launch iTerm or
  // Terminal, and pgrep/comm-name quirks (macOS reports the full executable
  // path, so `pgrep -x iTerm2` misses) can't cause silent drops.
  if (injectITerm(tty, message)) return
  if (injectTerminal(tty, message)) return
  // Both declined — inbox file on disk remains the durable artifact.
}

function runAppleScript(lines: string[]): { ok: boolean; stdout: string } {
  const args: string[] = []
  for (const line of lines) {
    args.push('-e', line)
  }
  const result = spawnSync('osascript', args, { encoding: 'utf-8' })
  const stdout = (result.stdout ?? '').trim()
  const ok = result.status === 0
  return { ok, stdout }
}

function injectITerm(tty: string, message: string): boolean {
  const quotedTty = JSON.stringify(tty)
  const quotedMsg = JSON.stringify(message)
  const { ok, stdout } = runAppleScript([
    'tell application "System Events"',
    '  if not (exists process "iTerm2") then return "NOTRUNNING"',
    'end tell',
    'tell application "iTerm2"',
    '  set targetSession to missing value',
    '  repeat with w in windows',
    '    repeat with t in tabs of w',
    '      repeat with s in sessions of t',
    `        if tty of s is equal to ${quotedTty} then`,
    '          set targetSession to s',
    '          exit repeat',
    '        end if',
    '      end repeat',
    '      if targetSession is not missing value then exit repeat',
    '    end repeat',
    '    if targetSession is not missing value then exit repeat',
    '  end repeat',
    '  if targetSession is missing value then return "NOMATCH"',
    `  tell targetSession to write text ${quotedMsg}`,
    '  return "OK"',
    'end tell',
  ])
  return ok && stdout === 'OK'
}

function injectTerminal(tty: string, message: string): boolean {
  const quotedTty = JSON.stringify(tty)
  const quotedMsg = JSON.stringify(message)
  const { ok, stdout } = runAppleScript([
    'tell application "System Events"',
    '  if not (exists process "Terminal") then return "NOTRUNNING"',
    'end tell',
    'tell application "Terminal"',
    '  set targetTab to missing value',
    '  repeat with w in windows',
    '    repeat with t in tabs of w',
    `      if tty of t is equal to ${quotedTty} then`,
    '        set targetTab to t',
    '        exit repeat',
    '      end if',
    '    end repeat',
    '    if targetTab is not missing value then exit repeat',
    '  end repeat',
    '  if targetTab is missing value then return "NOMATCH"',
    `  do script ${quotedMsg} in targetTab`,
    '  return "OK"',
    'end tell',
  ])
  return ok && stdout === 'OK'
}
