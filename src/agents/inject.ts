import fs from 'fs/promises'
import path from 'path'
import { execSync, spawnSync } from 'child_process'
import { buildBatchPrompt } from './prompts.js'
import type { EventBatch, PRMeta } from '../github/events.js'
import type { LinkedSessionRow } from '../db/queries.js'

export interface InjectResult {
  delivered: boolean
  via: 'tmux' | 'iterm' | 'terminal' | 'file_only'
  inboxPath: string
  reason?: string
}

export async function injectIntoSession(
  session: LinkedSessionRow,
  batch: EventBatch,
  prMeta: PRMeta,
  promptOverride?: string
): Promise<InjectResult> {
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

  const trigger = buildTriggerMessage(batch)

  if (session.tmux_pane) {
    if (await tryDeliverViaTmux(session.tmux_pane, trigger)) {
      return { delivered: true, via: 'tmux', inboxPath: inboxFile }
    }
  }

  const tty = resolveTty(session)
  if (!tty) {
    return {
      delivered: false,
      via: 'file_only',
      inboxPath: inboxFile,
      reason: 'no_tty_resolved',
    }
  }

  if (injectITerm(tty, trigger)) return { delivered: true, via: 'iterm', inboxPath: inboxFile }
  if (injectTerminal(tty, trigger)) return { delivered: true, via: 'terminal', inboxPath: inboxFile }
  return {
    delivered: false,
    via: 'file_only',
    inboxPath: inboxFile,
    reason: 'no_matching_terminal_window',
  }
}

export function focusSessionTerminal(session: LinkedSessionRow): { ok: boolean; via?: string; reason?: string } {
  const tty = resolveTty(session)
  if (!tty) return { ok: false, reason: 'no_tty_resolved' }
  if (focusITerm(tty)) return { ok: true, via: 'iterm' }
  if (focusTerminal(tty)) return { ok: true, via: 'terminal' }
  return { ok: false, reason: 'no_matching_terminal_window' }
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
    // display-message accepts any target form (pane ID %N, session:window.pane,
    // etc.) and fails if the target doesn't resolve to a live pane. Single
    // probe avoids the parsing ambiguity of has-session for pane-ID targets.
    execSync(`tmux display-message -t ${JSON.stringify(pane)} -p '#{pane_id}'`, {
      stdio: 'ignore',
    })
  } catch {
    return false
  }
  try {
    const submit = process.env.SENTINEL_AUTO_SUBMIT !== 'false'
    const escaped = prompt.replace(/'/g, `'"'"'`)
    if (submit) execSync(`tmux send-keys -t '${pane}' '' Enter`, { stdio: 'ignore' })
    execSync(
      `tmux send-keys -t '${pane}' '${escaped}'${submit ? ' Enter' : ''}`,
      { stdio: 'ignore' }
    )
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
  const submit = process.env.SENTINEL_AUTO_SUBMIT !== 'false'
  // Why two phases when auto-submit is on: `write text` sends the message
  // in bracketed-paste mode, so Claude Code treats any embedded CR as
  // literal paste content. A real Enter keystroke via System Events is
  // delivered outside the paste and Claude registers it as submit, exactly
  // like a physical keypress. The keystroke requires the target session
  // to be frontmost, so we briefly activate.
  //
  // When auto-submit is off, we only type. The text lands in Claude's
  // input; the user reviews and presses Enter themselves. No focus steal.
  const submitBlock = submit
    ? [
        '  activate',
        '  select targetWindow',
        '  tell targetWindow to select targetTab',
        '  tell targetSession to select',
        'end tell',
        'delay 0.1',
        'tell application "System Events" to key code 36',
      ]
    : ['end tell']
  const { ok, stdout } = runAppleScript([
    'tell application "System Events"',
    '  if not (exists process "iTerm2") then return "NOTRUNNING"',
    'end tell',
    'tell application "iTerm2"',
    '  set targetSession to missing value',
    '  set targetTab to missing value',
    '  set targetWindow to missing value',
    '  repeat with w in windows',
    '    repeat with t in tabs of w',
    '      repeat with s in sessions of t',
    `        if tty of s is equal to ${quotedTty} then`,
    '          set targetSession to s',
    '          set targetTab to t',
    '          set targetWindow to w',
    '          exit repeat',
    '        end if',
    '      end repeat',
    '      if targetSession is not missing value then exit repeat',
    '    end repeat',
    '    if targetSession is not missing value then exit repeat',
    '  end repeat',
    '  if targetSession is missing value then return "NOMATCH"',
    `  tell targetSession to write text ${quotedMsg} newline no`,
    ...submitBlock,
    'return "OK"',
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

function focusITerm(tty: string): boolean {
  const quotedTty = JSON.stringify(tty)
  const { ok, stdout } = runAppleScript([
    'tell application "System Events"',
    '  if not (exists process "iTerm2") then return "NOTRUNNING"',
    'end tell',
    'tell application "iTerm2"',
    '  set targetSession to missing value',
    '  set targetTab to missing value',
    '  set targetWindow to missing value',
    '  repeat with w in windows',
    '    repeat with t in tabs of w',
    '      repeat with s in sessions of t',
    `        if tty of s is equal to ${quotedTty} then`,
    '          set targetSession to s',
    '          set targetTab to t',
    '          set targetWindow to w',
    '          exit repeat',
    '        end if',
    '      end repeat',
    '      if targetSession is not missing value then exit repeat',
    '    end repeat',
    '    if targetSession is not missing value then exit repeat',
    '  end repeat',
    '  if targetSession is missing value then return "NOMATCH"',
    '  activate',
    '  select targetWindow',
    '  tell targetWindow to select targetTab',
    '  tell targetSession to select',
    '  return "OK"',
    'end tell',
  ])
  return ok && stdout === 'OK'
}

function focusTerminal(tty: string): boolean {
  const quotedTty = JSON.stringify(tty)
  const { ok, stdout } = runAppleScript([
    'tell application "System Events"',
    '  if not (exists process "Terminal") then return "NOTRUNNING"',
    'end tell',
    'tell application "Terminal"',
    '  set targetWindow to missing value',
    '  set targetTab to missing value',
    '  repeat with w in windows',
    '    repeat with t in tabs of w',
    `      if tty of t is equal to ${quotedTty} then`,
    '        set targetWindow to w',
    '        set targetTab to t',
    '        exit repeat',
    '      end if',
    '    end repeat',
    '    if targetTab is not missing value then exit repeat',
    '  end repeat',
    '  if targetTab is missing value then return "NOMATCH"',
    '  activate',
    '  set selected of targetTab to true',
    '  set frontmost of targetWindow to true',
    '  return "OK"',
    'end tell',
  ])
  return ok && stdout === 'OK'
}
