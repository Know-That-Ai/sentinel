import * as fs from 'fs'
import * as path from 'path'
import os from 'os'

// Bumped when the hook command changes — installHook replaces stale versions.
const SENTINEL_HOOK_VERSION = '2'

const SENTINEL_HOOK_ENTRY = {
  matcher: 'Bash',
  // sentinel-hook-version: 2
  hooks: [
    {
      type: 'command',
      command:
        'if echo "$CLAUDE_TOOL_OUTPUT" | grep -qE \'github\\.com/.+/pull/[0-9]+\'; then cd "$CLAUDE_TOOL_CWD" && sentinel link --silent; elif echo "$CLAUDE_TOOL_INPUT" | grep -qE \'git push\'; then cd "$CLAUDE_TOOL_CWD" && sentinel link --silent; fi',
    },
  ],
}

function isSentinelHook(entry: any): boolean {
  return entry?.hooks?.some(
    (h: any) => typeof h.command === 'string' && h.command.includes('sentinel link')
  ) ?? false
}

function defaultSettingsPath(): string {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function readSettings(settingsPath: string): Record<string, any> {
  if (!fs.existsSync(settingsPath)) {
    return {}
  }
  const raw = fs.readFileSync(settingsPath, 'utf-8')
  return JSON.parse(raw)
}

function writeSettings(settingsPath: string, settings: Record<string, any>): void {
  const dir = path.dirname(settingsPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

function isCurrentVersion(entry: any): boolean {
  return entry?.hooks?.some(
    (h: any) => typeof h.command === 'string' && h.command.includes(`sentinel link --silent`)
  ) ?? false
}

export async function installHook(settingsPath?: string): Promise<void> {
  const target = settingsPath ?? defaultSettingsPath()
  const settings = readSettings(target)

  if (!settings.hooks) settings.hooks = {}
  if (!Array.isArray(settings.hooks.PostToolUse)) settings.hooks.PostToolUse = []

  const existing = settings.hooks.PostToolUse.find(isSentinelHook)
  if (existing && isCurrentVersion(existing)) return

  // Remove stale sentinel hook (if any) and install current version
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    (e: any) => !isSentinelHook(e)
  )
  settings.hooks.PostToolUse.push(SENTINEL_HOOK_ENTRY)
  writeSettings(target, settings)
}

export async function uninstallHook(settingsPath?: string): Promise<void> {
  const target = settingsPath ?? defaultSettingsPath()

  if (!fs.existsSync(target)) {
    return
  }

  const settings = readSettings(target)

  if (!settings.hooks?.PostToolUse || !Array.isArray(settings.hooks.PostToolUse)) {
    return
  }

  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    (entry: any) => !isSentinelHook(entry)
  )

  writeSettings(target, settings)
}

// CLI entrypoint — when run directly via `pnpm run install-hook`
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].includes('install-hook')

if (isDirectRun) {
  const action = process.argv.includes('--uninstall') ? 'uninstall' : 'install'
  if (action === 'uninstall') {
    uninstallHook()
      .then(() => console.log('Sentinel hook removed from ~/.claude/settings.json'))
      .catch((e) => { console.error('Failed to remove hook:', e); process.exit(1) })
  } else {
    installHook()
      .then(() => console.log('Sentinel hook installed in ~/.claude/settings.json'))
      .catch((e) => { console.error('Failed to install hook:', e); process.exit(1) })
  }
}
