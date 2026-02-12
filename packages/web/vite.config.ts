import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const DEFAULT_PORT = 5173
const DEFAULT_API_PORT = 4000

const port = parseInt(process.env.VITE_PORT ?? String(DEFAULT_PORT), 10)
const apiPort = parseInt(process.env.VITE_API_PORT ?? String(DEFAULT_API_PORT), 10)

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
})
