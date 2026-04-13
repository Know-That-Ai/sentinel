import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('config', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.GITHUB_PAT = 'ghp_test'
    process.env.GITHUB_ORG = 'test-org'
    process.env.GITHUB_USERNAME = 'testuser'
    process.env.WEBHOOK_SECRET = 'secret123'
    process.env.PORT = '3847'
    process.env.SCANNER_BOT_LOGINS = 'bugbot[bot],github-advanced-security[bot]'
    process.env.REPO_PATHS = JSON.stringify({ 'test-org/test-repo': '/tmp/test-repo' })
  })

  it('loads valid config without throwing', async () => {
    const { loadConfig } = await import('../config')
    expect(() => loadConfig()).not.toThrow()
  })

  it('throws if GITHUB_PAT is missing', async () => {
    delete process.env.GITHUB_PAT
    const { loadConfig } = await import('../config')
    expect(() => loadConfig()).toThrow(/GITHUB_PAT/)
  })

  it('throws if WEBHOOK_SECRET is missing', async () => {
    delete process.env.WEBHOOK_SECRET
    const { loadConfig } = await import('../config')
    expect(() => loadConfig()).toThrow(/WEBHOOK_SECRET/)
  })

  it('parses REPO_PATHS as a map', async () => {
    const { loadConfig } = await import('../config')
    const config = loadConfig()
    expect(config.repoPaths['test-org/test-repo']).toBe('/tmp/test-repo')
  })

  it('parses SCANNER_BOT_LOGINS as an array', async () => {
    const { loadConfig } = await import('../config')
    const config = loadConfig()
    expect(config.scannerBotLogins).toContain('bugbot[bot]')
    expect(config.scannerBotLogins).toContain('github-advanced-security[bot]')
  })
})
