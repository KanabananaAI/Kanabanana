import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PORT = process.env.KANABAN_API_PORT || '3001'
const WHISPER_PORT = process.env.KANABAN_WHISPER_PORT || '3002'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/transcribe': {
        target: `http://localhost:${WHISPER_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace('/api/transcribe', '/transcribe'),
      },
      '/api': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
      },
      '/socket.io': {
        target: `http://localhost:${API_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
