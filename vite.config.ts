import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Tailscale serve forwards requests with the machine's *.ts.net name as the Host header.
  const allowedHosts = ['.ts.net', ...(env.VITE_ALLOWED_HOST ? [env.VITE_ALLOWED_HOST] : [])]

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 9445,
      allowedHosts,
    },
    preview: {
      port: 9445,
      allowedHosts,
    },
  }
})
