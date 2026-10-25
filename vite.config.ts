import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { metaCspPlugin, relayDevPlugin } from './server/vite-relay.ts'

// https://vite.dev/config/
// En GitHub Pages la app vive en /<repo>/: el workflow define VITE_BASE.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss(), relayDevPlugin(), metaCspPlugin()],
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
