import { Octokit } from '@octokit/rest'

const EVENTS_TO_SUBSCRIBE = [
  'check_run',
  'pull_request',
  'pull_request_review_comment',
  'pull_request_review',
  'issue_comment',
] as const

export interface SetupWebhooksOptions {
  webhookUrl: string
  org: string
  secret: string
  pat: string
  /** When rotating, the old smee URL to replace. Only that specific webhook
   *  is updated — teammates' hooks on the same repo are left untouched. */
  oldSmeeUrl?: string
}

export interface SetupWebhooksResult {
  created: string[]
  updated: string[]
  skipped: string[]
  errors: Array<{ repo: string; message: string }>
}

export async function setupWebhooks(opts: SetupWebhooksOptions): Promise<SetupWebhooksResult> {
  const { webhookUrl, org, secret, pat, oldSmeeUrl } = opts
  const octokit = new Octokit({ auth: pat })
  const result: SetupWebhooksResult = { created: [], updated: [], skipped: [], errors: [] }

  console.log(`Fetching repos for ${org}...`)
  const repos = await octokit.paginate(octokit.repos.listForOrg, {
    org,
    type: 'all',
    per_page: 100,
  })
  const activeRepos = repos.filter((r) => !r.archived && !r.disabled)
  console.log(`Found ${activeRepos.length} active repos`)

  for (const repo of activeRepos) {
    const [owner, repoName] = repo.full_name.split('/')
    try {
      const { data: hooks } = await octokit.repos.listWebhooks({ owner, repo: repoName })
      const sameUrl = hooks.find((h) => h.config.url === webhookUrl)

      if (sameUrl) {
        // URL matches — check whether events are current. If not, patch.
        const current = new Set(sameUrl.events)
        const missing = EVENTS_TO_SUBSCRIBE.filter((e) => !current.has(e))
        if (missing.length > 0) {
          await octokit.repos.updateWebhook({
            owner,
            repo: repoName,
            hook_id: sameUrl.id,
            events: [...EVENTS_TO_SUBSCRIBE],
            active: true,
          })
          console.log(`  [update] ${repo.full_name} — added events [${missing.join(', ')}] (id: ${sameUrl.id})`)
          result.updated.push(repo.full_name)
          continue
        }
        console.log(`  [skip] ${repo.full_name} — already registered (id: ${sameUrl.id})`)
        result.skipped.push(repo.full_name)
        continue
      }

      // If rotating, only replace the webhook pointing at OUR old URL — never
      // touch a teammate's hook just because it also happens to use smee.io.
      const staleSmee = oldSmeeUrl
        ? hooks.find((h) => h.config.url === oldSmeeUrl)
        : undefined
      if (staleSmee) {
        await octokit.repos.updateWebhook({
          owner,
          repo: repoName,
          hook_id: staleSmee.id,
          config: { url: webhookUrl, content_type: 'json', secret },
          events: [...EVENTS_TO_SUBSCRIBE],
          active: true,
        })
        console.log(`  [update] ${repo.full_name} — rotated to ${webhookUrl} (id: ${staleSmee.id})`)
        result.updated.push(repo.full_name)
        continue
      }

      const { data: hook } = await octokit.repos.createWebhook({
        owner,
        repo: repoName,
        config: { url: webhookUrl, content_type: 'json', secret },
        events: [...EVENTS_TO_SUBSCRIBE],
        active: true,
      })
      console.log(`  [ok] ${repo.full_name} — webhook created (id: ${hook.id})`)
      result.created.push(repo.full_name)
    } catch (err: any) {
      console.error(`  [error] ${repo.full_name} — ${err.message}`)
      result.errors.push({ repo: repo.full_name, message: err.message })
    }
  }
  return result
}

// Standalone CLI entrypoint — preserved for backward compatibility with
// `pnpm setup-webhooks --webhook-url=... --org=...`.
const isDirectRun =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].includes('setup-webhook')

if (isDirectRun) {
  const args = process.argv.slice(2)
  const webhookUrl =
    args.find((a) => a.startsWith('--webhook-url='))?.split('=')[1] ?? process.env.SMEE_URL
  const org =
    args.find((a) => a.startsWith('--org='))?.split('=')[1] ?? process.env.GITHUB_ORG
  const pat = process.env.GITHUB_PAT
  const secret = process.env.WEBHOOK_SECRET

  if (!pat) {
    console.error('Error: GITHUB_PAT environment variable is required.')
    process.exit(1)
  }
  if (!secret) {
    console.error('Error: WEBHOOK_SECRET environment variable is required.')
    process.exit(1)
  }
  if (!webhookUrl) {
    console.error('Error: --webhook-url (or SMEE_URL in .env) is required.')
    process.exit(1)
  }
  if (!org) {
    console.error('Error: --org (or GITHUB_ORG in .env) is required.')
    process.exit(1)
  }

  setupWebhooks({ webhookUrl, org, secret, pat })
    .then(() => console.log('Done.'))
    .catch((err) => {
      console.error('Fatal error:', err)
      process.exit(1)
    })
}
