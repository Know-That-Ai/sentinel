import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/.git/**', '**/.claude/**'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
    setupFiles: ['./src/test/setup.ts'],
  },
})
