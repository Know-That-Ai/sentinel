import { describe, it, expect } from 'vitest'
import { parseRemoteUrl } from '../../github/repos.js'

describe('parseRemoteUrl', () => {
  it('parses https remote with .git suffix', () => {
    const [owner, repo] = parseRemoteUrl('https://github.com/kya-os/checkpoint.git')
    expect(owner).toBe('kya-os')
    expect(repo).toBe('checkpoint')
  })

  it('parses https remote without .git suffix', () => {
    const [owner, repo] = parseRemoteUrl('https://github.com/kya-os/checkpoint')
    expect(owner).toBe('kya-os')
    expect(repo).toBe('checkpoint')
  })

  it('parses SSH remote', () => {
    const [owner, repo] = parseRemoteUrl('git@github.com:Know-That-Ai/sentinel.git')
    expect(owner).toBe('Know-That-Ai')
    expect(repo).toBe('sentinel')
  })

  it('parses SSH remote without .git suffix', () => {
    const [owner, repo] = parseRemoteUrl('git@github.com:mcp-i/mcp-i-core')
    expect(owner).toBe('mcp-i')
    expect(repo).toBe('mcp-i-core')
  })

  it('throws for an invalid URL', () => {
    expect(() => parseRemoteUrl('not-a-github-url')).toThrow(/Could not parse/)
  })

  it('throws for a non-GitHub URL', () => {
    expect(() => parseRemoteUrl('https://gitlab.com/owner/repo.git')).toThrow(/Could not parse/)
  })
})
