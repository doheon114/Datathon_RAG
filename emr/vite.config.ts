import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 빌드 산출물은 RAG 서버(9_notebook_web.py)가 /emr 로 서빙한다. 개발 중에는 /api 를 RAG 서버로 프록시한다.
export default defineConfig({
  base: '/emr/',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8800', changeOrigin: true },
      '/emr/api': { target: 'http://localhost:8800', changeOrigin: true },
    },
  },
})
