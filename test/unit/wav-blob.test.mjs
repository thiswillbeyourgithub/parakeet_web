// Tier-1 unit test for createWavBlob (app/ui/src/lib/audio.js), the 16-bit PCM
// WAV writer behind the inline history player, the recording download and the
// remote-mic batch that is handed to the transcription core as if it were an
// uploaded file. All three read the same bytes, so the header has to be right
// once rather than plausibly.
//
// It moved out of App() to be reachable from hooks/useRemoteMic.js; these are
// the first tests it has ever had.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createWavBlob } from '../../app/ui/src/lib/audio.js';

const str = (view, off, len) =>
  Array.from({ length: len }, (_, i) => String.fromCharCode(view.getUint8(off + i))).join('');

async function parse(pcm, rate) {
  const buf = await createWavBlob(pcm, rate).arrayBuffer();
  return { view: new DataView(buf), bytes: buf.byteLength };
}

describe('createWavBlob', () => {
  test('writes a canonical 44-byte mono 16-bit header', async () => {
    const { view, bytes } = await parse(new Float32Array(4), 16000);
    assert.equal(bytes, 44 + 8);
    assert.equal(str(view, 0, 4), 'RIFF');
    assert.equal(view.getUint32(4, true), 36 + 8); // everything after this field
    assert.equal(str(view, 8, 4), 'WAVE');
    assert.equal(str(view, 12, 4), 'fmt ');
    assert.equal(view.getUint32(16, true), 16); // PCM fmt chunk size
    assert.equal(view.getUint16(20, true), 1);  // format: PCM
    assert.equal(view.getUint16(22, true), 1);  // mono
    assert.equal(view.getUint32(24, true), 16000);
    assert.equal(view.getUint32(28, true), 32000); // byte rate = rate * 2
    assert.equal(view.getUint16(32, true), 2);  // block align
    assert.equal(view.getUint16(34, true), 16); // bits per sample
    assert.equal(str(view, 36, 4), 'data');
    assert.equal(view.getUint32(40, true), 8);
  });

  test('the declared sample rate follows the argument', async () => {
    const { view } = await parse(new Float32Array(2), 48000);
    assert.equal(view.getUint32(24, true), 48000);
    assert.equal(view.getUint32(28, true), 96000);
  });

  test('full scale maps to the int16 edges without wrapping', async () => {
    // The asymmetric scale is the point: -1.0 * 0x8000 is exactly -32768, while
    // -1.0 * 0x7FFF would land at -32767 and +1.0 * 0x8000 would WRAP to -32768.
    const { view } = await parse(Float32Array.from([-1, 1, 0]), 16000);
    assert.equal(view.getInt16(44, true), -32768);
    assert.equal(view.getInt16(46, true), 32767);
    assert.equal(view.getInt16(48, true), 0);
  });

  test('out-of-range samples are clamped rather than wrapped', async () => {
    const { view } = await parse(Float32Array.from([-4, 4]), 16000);
    assert.equal(view.getInt16(44, true), -32768);
    assert.equal(view.getInt16(46, true), 32767);
  });

  test('an empty clip is still a valid, header-only WAV', async () => {
    const { view, bytes } = await parse(new Float32Array(0), 16000);
    assert.equal(bytes, 44);
    assert.equal(view.getUint32(40, true), 0);
    assert.equal(view.getUint32(4, true), 36);
  });
});
