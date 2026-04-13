import fs from 'fs/promises'
import path from 'path'
import { execSync } from 'child_process'
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

  // Write to .sentinel/inbox/<pr-number>.md in the repo
  const inboxDir = path.join(session.repo_path, '.sentinel', 'inbox')
  await fs.mkdir(inboxDir, { recursive: true })
  const inboxFile = path.join(inboxDir, `${batch.prNumber}.md`)
  await fs.writeFile(inboxFile, prompt, 'utf-8')

  // Add .sentinel/ to .gitignore if not already present
  await ensureGitignore(session.repo_path, '.sentinel/')

  // Deliver to the terminal
  if (session.tmux_pane) {
    await deliverViaTmux(session.tmux_pane, prompt)
  } else if (session.terminal_pid) {
    await deliverViaOsascript(session.terminal_pid, prompt)
  }
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

function detectTerminalApp(_pid: number): 'Terminal' | 'iTerm2' | null {
  try {
    const result = execSync(
      `ps -p ${_pid} -o comm= 2>/dev/null || echo ''`,
      { encoding: 'utf-8' }
    ).trim()
    if (result.includes('iTerm')) return 'iTerm2'
    if (result.includes('Terminal')) return 'Terminal'
    return null
  } catch {
    return null
  }
}

function escapeForAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function deliverViaOsascript(pid: number, prompt: string): Promise<void> {
  const termApp = detectTerminalApp(pid)
  const escaped = escapeForAppleScript(prompt)

  if (termApp === 'iTerm2') {
    const script = `tell application "iTerm2" to tell current session of current window to write text "${escaped}"`
    execSync(`osascript -e '${script}'`, { stdio: 'ignore' })
  } else if (termApp === 'Terminal') {
    const script = `tell application "Terminal" to do script "${escaped}" in front window`
    execSync(`osascript -e '${script}'`, { stdio: 'ignore' })
  }
  // If no terminal found, injection was already written to inbox file
}
