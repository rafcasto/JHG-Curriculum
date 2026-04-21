import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy /api to the Vercel dev server (port 3000) during local development.
    // Run: npx vercel dev   instead of: npm run dev
    // Or keep using npm run dev for pure UI work — API calls will 404 locally.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
