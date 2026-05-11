// Eruda devtools opt-in loader. Externalised so script-src CSP can stay
// strict ('self' 'wasm-unsafe-eval') without an inline-script carve-out
// or per-response nonce. The eruda script itself is locally hosted with
// its own SRI; this loader is fetched same-origin and is itself loaded
// with SRI from the HTML entry points.
//
// Refresh recipe (run when pulling a newer eruda release to pick up
// upstream CVE fixes). The vendored copy in this repo otherwise stays
// frozen at whatever was last grabbed: SRI protects against tampering
// but says nothing about freshness.
//
//   ERUDA_VERSION=3.4.1   # bump as needed
//   curl -fsSL "https://cdn.jsdelivr.net/npm/eruda@${ERUDA_VERSION}/eruda.min.js" \
//     -o app/ui/public/js/eruda.min.js
//   echo "sha384-$(openssl dgst -sha384 -binary app/ui/public/js/eruda.min.js | base64)"
//   # Paste the printed hash into script.integrity below.
//
// After editing this file, recompute the loader's own SRI and update
// app/ui/index.html and app/ui/remote-mic.html (search for eruda-loader):
//
//   echo "sha384-$(openssl dgst -sha384 -binary app/ui/public/js/eruda-loader.js | base64)"
//
// qrcode.min.js has its own pin and recipe at app/ui/src/App.jsx:340.
(function () {
  try {
    if (new URL(location.href).searchParams.get('debug') !== '1') return;
  } catch (_) { return; }
  var script = document.createElement('script');
  script.src = '/js/eruda.min.js';
  script.integrity = 'sha384-F7xQBvh3l6dG/mMD6QPIeVmXtzWT4Ce3ZDu8ysPuzMWMx9bFOIMGnRPUhLuQipss';
  script.onload = function () {
    if (window.eruda && typeof window.eruda.init === 'function') {
      window.eruda.init();
      console.log('[Debug] Eruda devtools initialized (?debug=1)');
    }
  };
  script.onerror = function () {
    console.warn('[Debug] Failed to load eruda');
  };
  document.head.appendChild(script);
})();
