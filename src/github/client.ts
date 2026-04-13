import type { Octokit } from '@octokit/rest'
import { normalizeScannerComment, type SentinelEvent, type PRMeta } from './events.js'

export async function fetchScannerComments(
  octokit: Octokit,
  repo: string,
  prNumber: number,
  scannerLogin: string,
  since: Date,
  meta: PRMeta
): Promise<SentinelEvent[]> {
  const [owner, repoName] = repo.split('/')

  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo: repoName,
    issue_number: prNumber,
    since: since.toISOString(),
    per_page: 100,
  })

  return comments
    .filter(c => c.user?.login === scannerLogin)
    .map(c => normalizeScannerComment(c as any, repo, prNumber, meta))
}

export async function getPRMeta(
  octokit: Octokit,
  repo: string,
  prNumber: number
): Promise<PRMeta> {
  const [owner, repoName] = repo.split('/')
  const { data: pr } = await octokit.pulls.get({ owner, repo: repoName, pull_number: prNumber })
  return {
    prTitle: pr.title,
    prUrl: pr.html_url,
    prAuthor: pr.user?.login ?? '',
  }
}

export async function postPRComment(
  owner: string,
  repoName: string,
  prNumber: number,
  body: string,
  octokit?: Octokit
): Promise<{ id: number } | undefined> {
  if (!octokit) return undefined
  const { data } = await octokit.issues.createComment({
    owner,
    repo: repoName,
    issue_number: prNumber,
    body,
  })
  return { id: data.id }
}

export async function deletePRComment(
  owner: string,
  repoName: string,
  commentId: number,
  octokit?: Octokit
): Promise<void> {
  if (!octokit) return
  await octokit.issues.deleteComment({
    owner,
    repo: repoName,
    comment_id: commentId,
  }).catch(() => {})
}
