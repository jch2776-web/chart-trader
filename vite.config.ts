import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',   // 모든 네트워크 인터페이스에서 수신
    port: 5175,
    allowedHosts: true,
  },
})
