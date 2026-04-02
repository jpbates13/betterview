import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const allowedHost = env.VITE_ALLOWED_HOST

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 9445,
      ...(allowedHost ? { allowedHosts: [allowedHost] } : {}),
    },
  }
})
