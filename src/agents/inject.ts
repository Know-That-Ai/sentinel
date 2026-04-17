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

  if (session.tmux_pane) {
    await deliverViaTmux(session.tmux_pane, prompt)
    return
  }

  const tty = resolveTty(session)
  if (tty) {
    await deliverViaOsascript(tty, inboxFile)
  }
  // If no tty resolvable, inbox file is still written — Claude can read it.
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

async function deliverViaTmux(pane: string, prompt: string): Promise<void> {
  const escaped = prompt.replace(/'/g, `'"'"'`)
  execSync(`tmux send-keys -t '${pane}' '' Enter`, { stdio: 'ignore' })
  execSync(`tmux send-keys -t '${pane}' '${escaped}' Enter`, { stdio: 'ignore' })
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

function isAppRunning(appName: string): boolean {
  try {
    execSync(`pgrep -x ${JSON.stringify(appName)}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function deliverViaOsascript(tty: string, inboxFile: string): Promise<void> {
  // Try iTerm2 first if running; fall back to Terminal.app.
  // AppleScript reads the already-written inbox file via `do shell script cat`
  // so there's no string escaping between Node and AppleScript.
  if (isAppRunning('iTerm2') && injectITerm(tty, inboxFile)) return
  if (isAppRunning('Terminal') && injectTerminal(tty, inboxFile)) return
  // Silent fallback — inbox file on disk is the durable artifact.
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

function injectITerm(tty: string, inboxFile: string): boolean {
  const quotedTty = JSON.stringify(tty)
  const quotedFile = shellQuote(inboxFile)
  const { ok, stdout } = runAppleScript([
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
    `  set msg to (do shell script "cat " & ${quotedFile})`,
    '  tell targetSession to write text msg',
    '  return "OK"',
    'end tell',
  ])
  return ok && stdout === 'OK'
}

function injectTerminal(tty: string, inboxFile: string): boolean {
  const quotedTty = JSON.stringify(tty)
  const quotedFile = shellQuote(inboxFile)
  const { ok, stdout } = runAppleScript([
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
    `  set msg to (do shell script "cat " & ${quotedFile})`,
    '  do script msg in targetTab',
    '  return "OK"',
    'end tell',
  ])
  return ok && stdout === 'OK'
}

function shellQuote(path: string): string {
  // Produces an AppleScript expression that is itself a shell-safe single-quoted string.
  // e.g.  "'/Users/dylan/sentinel/inbox/42.md'"  as an AppleScript string literal.
  const inner = path.replace(/'/g, `'\\''`)
  return JSON.stringify(`'${inner}'`)
}
