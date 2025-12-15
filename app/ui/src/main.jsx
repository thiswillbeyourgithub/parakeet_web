import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Inject analytics script if environment variables are set
const analyticsUrl = import.meta.env.VITE_ANALYTICS_URL;
const analyticsWebsiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID;

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
root.render(<App />);
