// Eruda devtools opt-in loader. Externalised so script-src CSP can stay
// strict ('self' 'wasm-unsafe-eval') without an inline-script carve-out
// or per-response nonce. The eruda script itself is locally hosted with
// its own SRI; this loader is fetched same-origin and is itself loaded
// with SRI from the HTML entry points.
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
