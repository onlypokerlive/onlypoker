import path from 'node:path'
import { defineConfig } from 'vitest/config'

// No @vitejs/plugin-react: it wants a newer Vite than the one Vitest ships, and
// esbuild already compiles the JSX using the "react-jsx" runtime from
// tsconfig.json. The plugin only adds Fast Refresh, which tests never use.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    // Mirrors the "@/*" path alias from tsconfig.json.
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.next/**'],
  },
})
