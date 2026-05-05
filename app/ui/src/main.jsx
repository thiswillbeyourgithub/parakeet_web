import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { I18nProvider } from './i18n.jsx';
import { CONFIG } from './config.js';

// Global error surface: never let an exception or rejected promise fail silently.
// In production builds the stack is minified, but the user still sees that
// something went wrong instead of being stuck on a frozen status.
(function installGlobalErrorBanner() {
  let container = null;
  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.setAttribute('role', 'alert');
    container.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
      'background:#b91c1c', 'color:#fff',
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
      'padding:8px 36px 8px 12px', 'box-shadow:0 2px 6px rgba(0,0,0,.3)',
      'max-height:40vh', 'overflow:auto', 'white-space:pre-wrap',
    ].join(';');
    const close = document.createElement('button');
    close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss errors');
    close.style.cssText = [
      'position:absolute', 'top:4px', 'right:8px',
      'background:transparent', 'border:0', 'color:#fff',
      'font-size:20px', 'line-height:1', 'cursor:pointer',
    ].join(';');
    close.onclick = () => { container.remove(); container = null; };
    container.appendChild(close);
    (document.body || document.documentElement).appendChild(container);
    return container;
  }
  function show(label, detail) {
    try {
      const c = ensureContainer();
      const line = document.createElement('div');
      line.style.cssText = 'margin:4px 0;border-top:1px solid rgba(255,255,255,.25);padding-top:4px';
      line.textContent = `[${label}] ${detail}`;
      c.appendChild(line);
    } catch (_) { /* DOM not ready — already logged to console below */ }
  }
  window.addEventListener('error', (ev) => {
    const where = ev.filename ? ` (${ev.filename}:${ev.lineno}:${ev.colno})` : '';
    const msg = (ev.error && (ev.error.stack || ev.error.message)) || ev.message || 'Unknown error';
    console.error('[GlobalError]', msg, ev);
    show('Error', msg + where);
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    const msg = (r && (r.stack || r.message)) || String(r);
    console.error('[UnhandledRejection]', msg, ev);
    show('Unhandled promise rejection', msg);
  });
})();

// Inject analytics script if environment variables are set
const analyticsUrl = CONFIG.VITE_ANALYTICS_URL;
const analyticsWebsiteId = CONFIG.VITE_ANALYTICS_WEBSITE_ID;

if (analyticsUrl && analyticsWebsiteId) {
  const script = document.createElement('script');
  script.defer = true;
  script.src = analyticsUrl;
  script.setAttribute('data-website-id', analyticsWebsiteId);
  document.head.appendChild(script);
  console.log('[Analytics] Tracking initialized');
}

// Note: Eruda mobile debugger is now loaded in index.html for earlier initialization

const root = createRoot(document.getElementById('root'));
root.render(<I18nProvider><App /></I18nProvider>);
