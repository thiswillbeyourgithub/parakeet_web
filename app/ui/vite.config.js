import { defineConfig } from 'vite';
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

// Vendored Preact replaces React. The aliases below redirect every flavour of
// `react` / `react-dom` import to `preact/compat`, and the JSX automatic runtime
// to `preact/jsx-runtime`. No npm install reaches out for these — everything is
// served from app/ui/vendor/preact/.
const preactDir = path.resolve(__dirname, 'vendor/preact');
const preactCompat   = path.join(preactDir, 'compat/dist/compat.module.js');
const preactCompatClient = path.join(preactDir, 'compat/client.mjs');
const preactCore     = path.join(preactDir, 'dist/preact.module.js');
const preactHooks    = path.join(preactDir, 'hooks/dist/hooks.module.js');
const preactJsxRt    = path.join(preactDir, 'jsx-runtime/dist/jsxRuntime.module.js');

// Use array+regex form so each specifier is matched exactly (the object form
// does prefix matching, which would make `preact` swallow `preact/hooks`).
const preactAliases = [
  { find: /^react$/,              replacement: preactCompat },
  { find: /^react-dom$/,          replacement: preactCompat },
  { find: /^react-dom\/client$/,  replacement: preactCompatClient },
  { find: /^react\/jsx-runtime$/, replacement: preactJsxRt },
  { find: /^preact$/,             replacement: preactCore },
  { find: /^preact\/hooks$/,      replacement: preactHooks },
  { find: /^preact\/compat$/,     replacement: preactCompat },
  { find: /^preact\/jsx-runtime$/, replacement: preactJsxRt },
];

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: [
      { find: 'parakeet.js', replacement: path.resolve(__dirname, '../src/index.js') },
      ...preactAliases,
    ],
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
