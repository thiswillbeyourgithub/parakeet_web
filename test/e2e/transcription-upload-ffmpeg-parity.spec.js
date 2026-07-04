// Tier-3 E2E: an uploaded file is decoded in-browser by the vendored ffmpeg.wasm
// (src/lib/audioDecode.js), giving byte-for-byte parity with the CLI
// (scripts/transcribe.mjs `ffmpeg -i <file> -ac 1 -ar 16000 -f f32le`). The clip
// is venlaf.aac (== test/fixtures/sample.aac): a raw ADTS AAC whose encoder
// delay/priming the browser's decodeAudioData does NOT trim, which used to make
// the WebUI mishear "Venlafaxine" as "Velnafacine". ffmpeg trims it, so the drug
// name now decodes correctly, matching the CLI.
//
// This spec also enforces the production Content-Security-Policy (which serve.mjs
// omits) by injecting it on the document response, so it proves ffmpeg's module
// worker + ESM core + wasm all load under `script-src 'self' 'wasm-unsafe-eval'
// blob:` / `worker-src 'self' blob:` / `connect-src 'self' blob:` + COEP
// require-corp. If CSP blocked ffmpeg, the decoder would silently fall back to
// Web Audio (logging `via web-audio`) and mishear the word, failing the asserts.
//
// beamWidth is pinned to 1 (greedy) so the run is deterministic and directly
// comparable to the CLI golden generated at the same width.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { seedSettings } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(here, '../fixtures', name);

// The production Caddyfile CSP, with `upgrade-insecure-requests` dropped (it only
// matters on the https prod origin and would try to upgrade this http test
// origin's own fetches) and the operator HF-host allowlist left EMPTY, i.e. the
// tightest `connect-src 'self' blob:`. That is deliberate: it proves ffmpeg loads
// under the strictest connect-src (ffmpeg needs no HF host anyway, it loads from
// same-origin /ffmpeg/). Side effect: the app probes the default HF repo first,
// so this CSP blocks that probe and the load then falls back to the local /models
// mirror. Those cross-origin HF connect violations are expected (they rotate
// across HF's signed xet CDN hosts, so allowlisting them is futile) and the
// asserts below scope the CSP check to same-origin resources.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob:",
  "media-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "child-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// The app probes the default HF repo before falling back to the local /models
// mirror; under the strict CSP those cross-origin connects are blocked (expected,
// orthogonal to this feature). Match every HF CDN variant seen (huggingface.co,
// *.hf.co, *.xethub.hf.co) so they can be excluded from the error asserts.
const isHfConnect = (e) => /hf\.co|huggingface|xethub/i.test(e);

test('uploaded venlaf.aac decodes via ffmpeg.wasm under CSP and matches the CLI spelling', async ({ page }) => {
  const FIXTURE_AUDIO = fixture('sample.aac'); // byte-identical to audio_testfiles/venlaf.aac

  const errors = [];
  const logs = [];
  let decodedVia = null;
  let transcribeRuns = 0;
  page.on('console', (m) => {
    const text = m.text();
    logs.push(text);
    if (m.type() === 'error') errors.push(text);
    const via = text.match(/\[Transcribe\] Decoded \+ resampled to \d+Hz via ([\w.-]+)/);
    if (via) decodedVia = via[1];
    if (text.includes('[Transcribe] Total time for entire audio')) transcribeRuns += 1;
  });

  // Enforce the production CSP on the top-level document (serve.mjs does not set
  // it). Other requests pass through untouched so they keep serve.mjs's
  // COOP/COEP/CORP headers.
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const resp = await route.fetch();
    await route.fulfill({
      response: resp,
      headers: { ...resp.headers(), 'content-security-policy': PROD_CSP },
    });
  });

  // Seed local model source + wasm backend, and pin greedy decoding. Note
  // `modelSource: 'local'` ENABLES the local /models fallback; the app still
  // probes HuggingFace first, so the strict CSP above blocks that probe and the
  // load completes via the local mirror (see isHfConnect / the header comment).
  await page.goto('/');
  await seedSettings(page, { beamWidth: 1 });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // Upload the clip; uploads transcribe immediately.
  await page.locator('#audio-file-input').setInputFiles(FIXTURE_AUDIO);

  // Wait for the pipeline to finish one run.
  await expect.poll(() => transcribeRuns, { timeout: 6 * 60 * 1000 }).toBeGreaterThan(0);

  const historyText = page.locator('.history-text').first();
  await expect(historyText).not.toBeEmpty({ timeout: 60 * 1000 });
  const got = (await historyText.innerText()).trim();

  // 1) ffmpeg.wasm actually did the decode (i.e. its worker chunk, ESM core, and
  //    wasm ALL loaded + ran under the strict CSP). This is THE ffmpeg-under-CSP
  //    proof: if any of them were CSP-blocked, `getFFmpeg`/`load` would reject
  //    and the decoder would fall back to web-audio (`decodedVia === 'web-audio'`).
  expect(decodedVia, `decode path (logs:\n${logs.slice(-15).join('\n')})`).toBe('ffmpeg.wasm');

  // 2) No SAME-ORIGIN CSP violation surfaced. A CSP problem with ffmpeg's
  //    worker/core/wasm (all same-origin) would show up here; the app's blocked
  //    cross-origin HF probes are expected (see isHfConnect) and excluded.
  //    Assertion #1 already proves ffmpeg loaded un-blocked; this guards against
  //    a partial breakage that still somehow decoded.
  const cspErrors = errors.filter((e) => /content security policy|refused to (load|execute|connect)/i.test(e));
  const sameOriginCspErrors = cspErrors.filter((e) => !isHfConnect(e));
  expect(sameOriginCspErrors, `same-origin CSP violations:\n${sameOriginCspErrors.join('\n')}`).toHaveLength(0);

  // 3) CLI parity on the drug name: the whole point of the ffmpeg decode.
  //    The clean, priming-trimmed audio decodes to "Venlafaxine" like the CLI,
  //    not the browser-front-end artefacts "Velnafacine" / "Venafacine".
  expect(got.toLowerCase(), `transcript "${got}"`).toContain('venlafaxine');
  expect(got.toLowerCase(), `transcript "${got}"`).not.toMatch(/velnafac|venafac/);

  // NB: we deliberately do NOT assert app-wide `errors.length === 0` here. The
  // strict CSP intentionally blocks the app's HuggingFace probes (a HubDownloadError
  // + CSP-violation console errors), after which it falls back to the local /models
  // mirror; those, plus benign same-origin fallback-probe 404s, are expected. The
  // clean-load zero-errors contract is owned by transcription.spec.js, which runs
  // the same pipeline WITHOUT this artificial CSP.
});
