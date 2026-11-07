import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Backend runs on 8012 (8000 is often taken by the course website server).
const backend = process.env.VITE_API_BASE || 'http://127.0.0.1:8012'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/pages': { target: backend, changeOrigin: true },
    },
  },
})
