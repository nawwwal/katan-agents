import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1200 },
  server: {
    proxy: {
      '/agent-api': {
        target: 'http://127.0.0.1:8787',
        rewrite: (path) => path.replace(/^\/agent-api/, ''),
      },
    },
  },
  preview: {
    proxy: {
      '/agent-api': {
        target: 'http://127.0.0.1:8787',
        rewrite: (path) => path.replace(/^\/agent-api/, ''),
      },
    },
  },
})
