import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { I18nProvider } from './i18n.jsx';
import { CONFIG } from './config.js';

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
