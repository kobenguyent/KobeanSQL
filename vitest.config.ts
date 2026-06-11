import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['tests/database-visualizer.spec.ts', 'tests/foreign-key-navigation.test.ts'],
    isolate: true,
    // Ensure each test file gets a fresh module registry
    pool: 'forks'
  }
})
