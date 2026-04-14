import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Optional HTTPS setup - only if certificates exist
let httpsConfig = false;
try {
  const keyPath = path.resolve('./localhost-key.pem');
  const certPath = path.resolve('./localhost.pem');
  
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    httpsConfig = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    console.log('✅ HTTPS enabled with local certificates');
  } else {
    console.log('ℹ️ No local certificates found, running on HTTP');
  }
} catch (err) {
  console.log('ℹ️ HTTPS setup failed, running on HTTP:', err.message);
}

// Read version from parent package.json so App.jsx stays in sync automatically
const parentPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

export default defineConfig({
  plugins: [
    react(),
    // PWA plugin: generates manifest.webmanifest and a service worker for offline support.
    // Models are cached in IndexedDB by the app itself, so the SW only handles static assets.
    VitePWA({
      registerType: 'autoUpdate',
      // NetworkFirst so the app always fetches fresh assets when online,
      // but falls back to cache when offline (app shell only — models use IndexedDB).
      workbox: {
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document' || request.destination === 'script' || request.destination === 'style',
            handler: 'NetworkFirst',
            options: { cacheName: 'app-shell' },
          },
        ],
      },
      manifest: {
        name: 'ParakeetWeb',
        short_name: 'ParakeetWeb',
        description: 'Browser-based speech-to-text running entirely client-side',
        theme_color: '#1a1a2e',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      'parakeet.js': path.resolve(__dirname, '../src/index.js'),
    },
  },
  server: {
    port: 5173,
    ...(httpsConfig && { https: httpsConfig }),
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    ...(process.env.VITE_ALLOWED_HOST && {
      allowedHosts: process.env.VITE_ALLOWED_HOST.split(',').map(h => h.trim())
    }),
    // Enable file watching with polling when VITE_USE_POLLING is set to 'true'
    // This is useful for Docker environments where native file system events don't work reliably
    watch: {
      usePolling: process.env.VITE_USE_POLLING === 'true',
    },
    // Proxy signaling API to the Express signaling server (remote mic feature)
    proxy: {
      '/api/signal': {
        target: `http://localhost:${process.env.SIGNALING_PORT || 3001}`,
        rewrite: (p) => p.replace(/^\/api\/signal/, '/api'),
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'remote-mic': path.resolve(__dirname, 'remote-mic.html'),
      },
    },
  },
  optimizeDeps: {
    include: ['onnxruntime-web'],
  },
  define: {
    global: 'globalThis',
    __APP_VERSION__: JSON.stringify(parentPkg.version),
  },
}); 
