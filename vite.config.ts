import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Tailscale serve forwards requests with the machine's *.ts.net name as the Host header.
  const allowedHosts = ['.ts.net', ...(env.VITE_ALLOWED_HOST ? [env.VITE_ALLOWED_HOST] : [])]
  // Bind IPv4 loopback explicitly: "localhost" can resolve to ::1 only (Windows, newer
  // Node), and `tailscale serve 9445` proxies to 127.0.0.1, so it would get no answer.
  const host = '127.0.0.1'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host,
      port: 9445,
      allowedHosts,
    },
    preview: {
      host,
      port: 9445,
      allowedHosts,
    },
  }
})
