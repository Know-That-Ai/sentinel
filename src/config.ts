export interface SentinelConfig {
  githubPat: string
  githubOrg: string
  githubUsername: string
  webhookSecret: string
  port: number
  scannerBotLogins: string[]
  repoPaths: Record<string, string>
  preferredAgent: 'claude-code' | 'openclaw' | 'manual-only'
  openclawUrl: string
  openclawApiKey: string
  openclawGithubLogins: string[]
  autoDispatchBugbot: boolean
  autoDispatchCodeql: boolean
  autoDispatchCI: boolean
  defaultTmuxPane: string | null
  userLabel: string
}

function requireEnv(key: string): string {
  const value = process.env[key]
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

export function loadConfig(): SentinelConfig {
  const githubPat = requireEnv('GITHUB_PAT')
  const webhookSecret = requireEnv('WEBHOOK_SECRET')

  const repoPathsRaw = process.env.REPO_PATHS ?? '{}'
  let repoPaths: Record<string, string>
  try {
    repoPaths = JSON.parse(repoPathsRaw)
  } catch {
    throw new Error('REPO_PATHS must be a valid JSON object mapping "owner/repo" to local paths')
  }

  return {
    githubPat,
    githubOrg: process.env.GITHUB_ORG ?? '',
    githubUsername: process.env.GITHUB_USERNAME ?? '',
    webhookSecret,
    port: parseInt(process.env.PORT ?? '3847', 10),
    scannerBotLogins: (process.env.SCANNER_BOT_LOGINS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean),
    repoPaths,
    preferredAgent: (process.env.PREFERRED_AGENT as SentinelConfig['preferredAgent']) ?? 'claude-code',
    openclawUrl: process.env.OPENCLAW_URL ?? 'http://localhost:4000',
    openclawApiKey: process.env.OPENCLAW_API_KEY ?? '',
    openclawGithubLogins: (process.env.OPENCLAW_GITHUB_LOGINS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean),
    autoDispatchBugbot: process.env.AUTO_DISPATCH_BUGBOT === 'true',
    autoDispatchCodeql: process.env.AUTO_DISPATCH_CODEQL === 'true',
    autoDispatchCI: process.env.AUTO_DISPATCH_CI === 'true',
    defaultTmuxPane: process.env.SENTINEL_DEFAULT_TMUX_PANE ?? null,
    userLabel: process.env.SENTINEL_USER_LABEL ?? '',
  }
}

export function getAutoDispatchRules(): { bugbot: boolean; codeql: boolean; ci: boolean } {
  return {
    bugbot: process.env.AUTO_DISPATCH_BUGBOT === 'true',
    codeql: process.env.AUTO_DISPATCH_CODEQL === 'true',
    ci: process.env.AUTO_DISPATCH_CI === 'true',
  }
}

export function resolveRepoPath(repo: string): string {
  const repoPathsRaw = process.env.REPO_PATHS ?? '{}'
  const repoPaths: Record<string, string> = JSON.parse(repoPathsRaw)
  const repoPath = repoPaths[repo]
  if (!repoPath) {
    throw new Error(`No path mapping found for ${repo} in REPO_PATHS`)
  }
  return repoPath
}
