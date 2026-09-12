// Tier-1 gate on the order of the encoder-precision radios.
//
// The column is ordered by DOWNLOAD SIZE, smallest first, because that is the
// axis the visitor is trading in it and the only one every row compares on
// (quality and speed do not order the same way: w4a8 is the smallest download
// AND the slowest to run). Nothing enforces that at runtime, so the order is
// one careless edit away from becoming arbitrary again, and the regression is
// invisible: every radio still works.
//
// So the order is checked against the sizes the LABELS themselves quote, rather
// than against a second hard-coded list that would just have to be kept in sync.
// A row whose size changes therefore forces the order to be revisited, which is
// the moment the decision is actually up for review.
//
// Only i18n.jsx is read as text (a large literal, not importable under node,
// and the repo already tests shipped source this way: pipeline-trouble,
// entrypoint-model-repo). Everything else is imported as a real value from
// lib/encoderQuants.js, which is plain JS on purpose so hub.js's servability
// rules can be unit-tested. That includes the row order itself, which used to
// be scraped out of App.jsx: the scrape broke twice, once when the whitelists
// moved into lib/ and once when the order followed the radios into
// components/settings/EngineSection.jsx, and a scrape that stops matching
// reports the same thing as a genuine drift.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ENCODER_QUANT_ROWS,
  QUANT_DOWNLOAD_MB,
  WASM_ENCODER_QUANTS,
  WEBGPU_ENCODER_QUANTS,
} from '../../app/ui/src/lib/encoderQuants.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');
const I18N = read('app/ui/src/i18n.jsx');

const ROWS = ENCODER_QUANT_ROWS;
const LABEL_KEY = {
  int8lite: 'precisionInt8Lite',
  int8: 'precisionInt8',
  w4a8: 'precisionW4a8',
  fp16: 'precisionFp16',
  fp32: 'precisionFp32',
};

// Every quoted size for one label key, in MB, in both languages (~900MB, ~1.2GB,
// ~810 Mo, ~1,2 Go). Returned as a list so the two translations can be compared
// against each other as well as used for the ordering.
function sizesMb(key) {
  const lines = [...I18N.matchAll(new RegExp(`${key}: '([^']+)'`, 'g'))].map((m) => m[1]);
  assert.equal(lines.length, 2, `${key} must exist in exactly the two languages`);
  return lines.map((line) => {
    const m = line.match(/~\s*([\d.,]+)\s*(MB|GB|Mo|Go)/);
    assert.ok(m, `no size quoted in ${key}: ${line}`);
    const value = parseFloat(m[1].replace(',', '.'));
    return /^G/.test(m[2]) ? value * 1000 : value;
  });
}

describe('encoder-precision radio order', () => {
  test('the rows are the union of the per-backend whitelists', () => {
    // A precision a backend accepts but the UI never renders is unreachable
    // except by seeding storage by hand, which is how int8lite first shipped.
    const whitelisted = new Set([...WASM_ENCODER_QUANTS, ...WEBGPU_ENCODER_QUANTS]);
    assert.deepEqual([...ROWS].sort(), [...whitelisted].sort());
  });

  test('every row quotes the same size in both languages', () => {
    for (const row of ROWS) {
      const [en, fr] = sizesMb(LABEL_KEY[row]);
      assert.equal(fr, en, `${row}: the French label quotes a different size`);
    }
  });

  test('the size table and the radio label quote the same download for a row', () => {
    // Two places tell the visitor how big a precision is: the radio label
    // (i18n, prose, rounded to a human number) and QUANT_DOWNLOAD_MB, which the
    // benchmark plan prices its rows from and which the sidebar quotes above
    // the Load button. They describe the SAME file, so a visitor who reads
    // "~610MB" on the radio and is then quoted 900MB for the load they are
    // about to start has to be reading two consistent numbers, or the estimate
    // is worse than no estimate. Rounding is allowed (the labels say ~1.2GB for
    // 1220MB), a different file is not.
    for (const row of ROWS) {
      const [labelMb] = sizesMb(LABEL_KEY[row]);
      const tableMb = QUANT_DOWNLOAD_MB[row];
      assert.ok(tableMb, `${row}: no QUANT_DOWNLOAD_MB entry`);
      const drift = Math.abs(tableMb - labelMb) / labelMb;
      assert.ok(drift < 0.05,
        `${row}: label says ~${labelMb}MB but QUANT_DOWNLOAD_MB says ${tableMb}MB`);
    }
  });

  test('the rows run smallest download first', () => {
    const sizes = ROWS.map((row) => sizesMb(LABEL_KEY[row])[0]);
    assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b),
      `expected ascending size, got ${ROWS.map((r, i) => `${r} ${sizes[i]}MB`).join(', ')}`);
  });
});
