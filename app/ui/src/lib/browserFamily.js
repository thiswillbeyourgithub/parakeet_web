// Pure engine-family detection behind the slow-browser warning popup.
//
// Why it exists: the WASM speech engine is ~9x slower on Firefox than on any
// Chromium-based browser on the same machine (515 s vs 54 s for a 3-min clip,
// 2026-08-10; kernel-level benches pinned it on SpiderMonkey's SIMD codegen,
// not threading, so it is not fixable app-side). Users deserve that heads-up
// BEFORE they wait ten minutes on a recording, so App.jsx shows a dismissable
// (never persisted) popup on every non-Chromium load.
//
// Detection, in order of preference:
// 1. userAgentData.brands containing "Chromium": the honest signal, exposed
//    by every Chromium derivative (Chrome, Brave, Edge, Opera...) and by
//    nothing else (Firefox and Safari do not implement userAgentData).
// 2. UA-string fallback for older Chromium without client hints: every
//    Chromium UA carries "Chrome/NN" (Brave included; Edge adds "Edg/" but
//    keeps "Chrome/"), while Firefox ("Firefox/") and Safari (no "Chrome/")
//    do not.
// Unknown/absent navigator resolves to true (do not nag when we cannot tell:
// e.g. tests or exotic embedders).
//
// Written with the help of Claude Code.

export function isChromiumFamily(nav) {
  try {
    if (!nav) return true;
    const brands = nav.userAgentData && nav.userAgentData.brands;
    if (Array.isArray(brands) && brands.length) {
      return brands.some((b) => /chromium/i.test((b && b.brand) || ''));
    }
    const ua = typeof nav.userAgent === 'string' ? nav.userAgent : '';
    if (!ua) return true;
    return /Chrome\/\d/.test(ua);
  } catch {
    return true;
  }
}
