import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [TanStackRouterVite({ autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'react-vendor'
          if (id.includes('/@tanstack/')) return 'tanstack-vendor'
          if (id.includes('/@xterm/')) return 'xterm-vendor'
          if (id.includes('/@monaco-editor/') || id.includes('/monaco-editor/')) return 'monaco-vendor'
          if (id.includes('/react-markdown/')) return 'markdown-vendor'
          if (id.includes('/i18next/') || id.includes('/react-i18next/')) return 'i18n-vendor'
          if (id.includes('/pocketbase/')) return 'pb-vendor'
        },
      },
    },
  },
})
