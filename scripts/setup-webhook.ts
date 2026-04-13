import { Octokit } from '@octokit/rest'

const GITHUB_PAT = process.env.GITHUB_PAT
const GITHUB_ORG = process.env.GITHUB_ORG
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET

const args = process.argv.slice(2)
const webhookUrlArg = args.find(a => a.startsWith('--webhook-url='))
const orgArg = args.find(a => a.startsWith('--org='))

const webhookUrl = webhookUrlArg?.split('=')[1]
const org = orgArg?.split('=')[1] ?? GITHUB_ORG

if (!GITHUB_PAT) {
  console.error('Error: GITHUB_PAT environment variable is required.')
  process.exit(1)
}

if (!WEBHOOK_SECRET) {
  console.error('Error: WEBHOOK_SECRET environment variable is required.')
  process.exit(1)
}

if (!webhookUrl) {
  console.error('Error: --webhook-url=<url> argument is required.')
  console.error('Usage: pnpm tsx scripts/setup-webhook.ts --webhook-url=https://your-url/webhook [--org=your-org]')
  process.exit(1)
}

if (!org) {
  console.error('Error: --org=<org> argument or GITHUB_ORG env var is required.')
  process.exit(1)
}

const EVENTS_TO_SUBSCRIBE = ['check_run', 'pull_request', 'pull_request_review_comment'] as const

const octokit = new Octokit({ auth: GITHUB_PAT })

async function main() {
  console.log(`Fetching repos for ${org}...`)

  const repos = await octokit.paginate(octokit.repos.listForOrg, {
    org,
    type: 'all',
    per_page: 100,
  })

  const activeRepos = repos.filter(r => !r.archived && !r.disabled)
  console.log(`Found ${activeRepos.length} active repos`)

  for (const repo of activeRepos) {
    const [owner, repoName] = repo.full_name.split('/')
    try {
      // Check for existing sentinel webhook
      const { data: hooks } = await octokit.repos.listWebhooks({
        owner,
        repo: repoName,
      })

      const existingHook = hooks.find(h =>
        h.config.url === webhookUrl
      )

      if (existingHook) {
        console.log(`  [skip] ${repo.full_name} — webhook already registered (id: ${existingHook.id})`)
        continue
      }

      const { data: hook } = await octokit.repos.createWebhook({
        owner,
        repo: repoName,
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: WEBHOOK_SECRET,
        },
        events: [...EVENTS_TO_SUBSCRIBE],
        active: true,
      })

      console.log(`  [ok] ${repo.full_name} — webhook created (id: ${hook.id})`)
    } catch (err: any) {
      console.error(`  [error] ${repo.full_name} — ${err.message}`)
    }
  }

  console.log('Done.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
