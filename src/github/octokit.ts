import { Octokit } from '@octokit/rest'

let _octokit: Octokit | null = null

export function getOctokit(): Octokit {
  if (!_octokit) {
    const pat = process.env.GITHUB_PAT
    if (!pat) throw new Error('GITHUB_PAT is required to initialize Octokit')
    _octokit = new Octokit({ auth: pat })
  }
  return _octokit
}

export function resetOctokit(): void {
  _octokit = null
}
