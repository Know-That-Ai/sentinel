import { execSync } from 'child_process'
import type { Octokit } from '@octokit/rest'

export function parseRemoteUrl(url: string): [string, string] {
  const match = url.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/)
  if (!match) throw new Error(`Could not parse GitHub remote from: ${url}`)
  return [match[1], match[2]]
}

export function getCurrentBranch(cwd: string): string {
  return execSync('git rev-parse --abbrev-ref HEAD', { cwd })
    .toString().trim()
}

export function parseRemote(cwd: string): [string, string] {
  const remote = execSync('git remote get-url origin', { cwd })
    .toString().trim()
  return parseRemoteUrl(remote)
}

export async function resolveBranchToPR(
  repoPath: string,
  octokit: Octokit
): Promise<{ repo: string; prNumber: number } | null> {
  const branch = getCurrentBranch(repoPath)
  const [owner, repo] = parseRemote(repoPath)

  const { data } = await octokit.pulls.list({
    owner, repo,
    state: 'open',
    head: `${owner}:${branch}`,
    per_page: 1,
  })

  return data[0]
    ? { repo: `${owner}/${repo}`, prNumber: data[0].number }
    : null
}
