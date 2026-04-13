import { vi } from 'vitest'

// Mock node-notifier globally — tests should never fire real macOS notifications
vi.mock('node-notifier', () => ({
  default: { notify: vi.fn() },
}))

// Mock child_process.spawn — tests should never launch real claude processes
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, spawn: vi.fn() }
})
