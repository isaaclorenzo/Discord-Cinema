import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { relayDevPlugin } from './server/vite-relay'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), relayDevPlugin()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
