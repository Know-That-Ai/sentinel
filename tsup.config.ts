import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/main.ts', 'src/cli.ts', 'src/menubar/index.ts'],
  format: ['esm'],
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: false,
})
