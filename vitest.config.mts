import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    setupFiles: ['src/test/setup.ts'],
    environment: 'jsdom',
    env: {
      // 决策 #17：默认目录源是 DB，单元测试保持纯内存 seed 语义（不落盘）。
      CATALOG_SOURCE: 'seed',
    },
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
})
