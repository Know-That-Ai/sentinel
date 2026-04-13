import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import os from 'os'
import path from 'path'

describe('Claude Code hook installation', () => {
  const hookRegex = /github\.com\/.+\/pull\/[0-9]+/

  it('regex matches standard gh pr create output', () => {
    const output = 'https://github.com/org/repo/pull/142'
    expect(hookRegex.test(output)).toBe(true)
  })

  it('regex matches org names with hyphens', () => {
    const output = 'https://github.com/my-org/my-repo/pull/1'
    expect(hookRegex.test(output)).toBe(true)
  })

  it('regex does not match issue URLs', () => {
    const output = 'https://github.com/org/repo/issues/142'
    expect(hookRegex.test(output)).toBe(false)
  })

  it('regex does not match plain github.com URLs', () => {
    const output = 'https://github.com/org/repo'
    expect(hookRegex.test(output)).toBe(false)
  })

  describe('installHook', () => {
    let tmpSettings: string

    beforeEach(() => {
      tmpSettings = path.join(os.tmpdir(), `sentinel-test-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    })

    afterEach(() => {
      if (fs.existsSync(tmpSettings)) {
        fs.unlinkSync(tmpSettings)
      }
    })

    it('creates settings file when none exists', async () => {
      const { installHook } = await import('../../../scripts/install-hook')
      await installHook(tmpSettings)

      expect(fs.existsSync(tmpSettings)).toBe(true)
      const settings = JSON.parse(fs.readFileSync(tmpSettings, 'utf-8'))
      expect(settings.hooks).toBeDefined()
      expect(settings.hooks.PostToolUse).toBeDefined()
      expect(settings.hooks.PostToolUse.length).toBeGreaterThan(0)
    })

    it('is idempotent — does not add duplicate hook', async () => {
      const { installHook } = await import('../../../scripts/install-hook')

      await installHook(tmpSettings)
      await installHook(tmpSettings)

      const settings = JSON.parse(fs.readFileSync(tmpSettings, 'utf-8'))
      const sentinelHooks = settings.hooks.PostToolUse.filter((h: any) =>
        h.hooks?.some((hh: any) => hh.command?.includes('sentinel link'))
      )
      expect(sentinelHooks).toHaveLength(1)
    })

    it('preserves existing hooks', async () => {
      const existing = {
        hooks: {
          PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing' }] }],
        },
      }
      fs.writeFileSync(tmpSettings, JSON.stringify(existing))

      const { installHook } = await import('../../../scripts/install-hook')
      await installHook(tmpSettings)

      const settings = JSON.parse(fs.readFileSync(tmpSettings, 'utf-8'))
      const allCommands = settings.hooks.PostToolUse.flatMap((h: any) =>
        h.hooks?.map((hh: any) => hh.command) ?? []
      )
      expect(allCommands).toContain('echo existing')
      expect(allCommands.some((c: string) => c.includes('sentinel link'))).toBe(true)
    })

    it('preserves non-hook settings', async () => {
      const existing = {
        theme: 'dark',
        someOtherSetting: true,
      }
      fs.writeFileSync(tmpSettings, JSON.stringify(existing))

      const { installHook } = await import('../../../scripts/install-hook')
      await installHook(tmpSettings)

      const settings = JSON.parse(fs.readFileSync(tmpSettings, 'utf-8'))
      expect(settings.theme).toBe('dark')
      expect(settings.someOtherSetting).toBe(true)
      expect(settings.hooks.PostToolUse).toBeDefined()
    })

    it('hook command includes the correct grep pattern', async () => {
      const { installHook } = await import('../../../scripts/install-hook')
      await installHook(tmpSettings)

      const settings = JSON.parse(fs.readFileSync(tmpSettings, 'utf-8'))
      const sentinelEntry = settings.hooks.PostToolUse.find((h: any) =>
        h.hooks?.some((hh: any) => hh.command?.includes('sentinel link'))
      )
      const command = sentinelEntry.hooks[0].command as string
      expect(command).toContain('github\\.com/.+/pull/[0-9]+')
    })

    it('hook has matcher set to Bash', async () => {
      const { installHook } = await import('../../../scripts/install-hook')
      await installHook(tmpSettings)

      const settings = JSON.parse(fs.readFileSync(tmpSettings, 'utf-8'))
      const sentinelEntry = settings.hooks.PostToolUse.find((h: any) =>
        h.hooks?.some((hh: any) => hh.command?.includes('sentinel link'))
      )
      expect(sentinelEntry.matcher).toBe('Bash')
    })
  })

  describe('uninstallHook', () => {
    let tmpSettings: string

    beforeEach(() => {
      tmpSettings = path.join(os.tmpdir(), `sentinel-test-settings-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    })

    afterEach(() => {
      if (fs.existsSync(tmpSettings)) {
        fs.unlinkSync(tmpSettings)
      }
    })

    it('removes sentinel hook and preserves others', async () => {
      const { installHook, uninstallHook } = await import('../../../scripts/install-hook')
      // First install a non-sentinel hook, then install sentinel, then uninstall sentinel
      const existing = {
        hooks: {
          PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other-hook' }] }],
        },
      }
      fs.writeFileSync(tmpSettings, JSON.stringify(existing))

      await installHook(tmpSettings)
      await uninstallHook(tmpSettings)

      const settings = JSON.parse(fs.readFileSync(tmpSettings, 'utf-8'))
      const sentinelHooks = (settings.hooks?.PostToolUse ?? []).filter((h: any) =>
        h.hooks?.some((hh: any) => hh.command?.includes('sentinel link'))
      )
      expect(sentinelHooks).toHaveLength(0)
      // Other hook preserved
      const otherHooks = settings.hooks.PostToolUse.filter((h: any) =>
        h.hooks?.some((hh: any) => hh.command?.includes('echo other-hook'))
      )
      expect(otherHooks).toHaveLength(1)
    })

    it('is safe to call when no sentinel hook is installed', async () => {
      const { uninstallHook } = await import('../../../scripts/install-hook')
      const existing = {
        hooks: {
          PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo existing' }] }],
        },
      }
      fs.writeFileSync(tmpSettings, JSON.stringify(existing))

      await expect(uninstallHook(tmpSettings)).resolves.not.toThrow()

      const settings = JSON.parse(fs.readFileSync(tmpSettings, 'utf-8'))
      expect(settings.hooks.PostToolUse).toHaveLength(1)
    })

    it('is safe to call when settings file does not exist', async () => {
      const { uninstallHook } = await import('../../../scripts/install-hook')
      await expect(uninstallHook(tmpSettings)).resolves.not.toThrow()
    })

    it('preserves non-hook settings after uninstall', async () => {
      const { installHook, uninstallHook } = await import('../../../scripts/install-hook')
      const existing = { theme: 'dark' }
      fs.writeFileSync(tmpSettings, JSON.stringify(existing))

      await installHook(tmpSettings)
      await uninstallHook(tmpSettings)

      const settings = JSON.parse(fs.readFileSync(tmpSettings, 'utf-8'))
      expect(settings.theme).toBe('dark')
    })
  })
})
