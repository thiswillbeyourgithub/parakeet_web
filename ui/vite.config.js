import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
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

export default defineConfig({
  plugins: [react()],
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
  },
  optimizeDeps: {
    include: ['onnxruntime-web'],
  },
  define: {
    global: 'globalThis',
  },
}); 
