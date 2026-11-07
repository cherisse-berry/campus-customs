/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard runs at http://localhost:5173 (npm run dev) and calls the FastAPI
// backend at http://localhost:8000 directly (the backend allows this address).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: 'localhost' },
  test: { environment: 'node' },
})
