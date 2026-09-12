// Tier-1 unit test for createLevelMonitor (app/ui/src/lib/audio.js).
//
// The leak it pins: stop() used to only end the requestAnimationFrame loop and
// left the AnalyserNode connected to the source. App.jsx builds one per
// recording (two call sites) and remote-mic-entry.jsx two more, so on a page
// where someone records repeatedly they accumulated for the life of the tab,
// each still being fed samples by the audio graph.
//
// Built with Claude Code.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLevelMonitor } from '../../app/ui/src/lib/audio.js';

// Minimal Web Audio stand-ins: enough graph bookkeeping to see the connect and
// the disconnect, and a scripted time-domain buffer to check the RMS maths.
function makeGraph({ sample = 128 } = {}) {
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    disconnected: 0,
    getByteTimeDomainData(arr) { arr.fill(sample); },
    disconnect() { this.disconnected += 1; },
  };
  const source = { connectedTo: [], connect(node) { this.connectedTo.push(node); } };
  return { audioCtx: { createAnalyser: () => analyser }, source, analyser };
}

let frames = [];
let realRaf = null;
function stubRaf() {
  realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
}
afterEach(() => {
  if (realRaf === undefined) delete globalThis.requestAnimationFrame;
  else if (realRaf) globalThis.requestAnimationFrame = realRaf;
  realRaf = null;
  frames = [];
});

describe('createLevelMonitor', () => {
  test('stop() disconnects the analyser, not just the rAF loop', () => {
    stubRaf();
    const { audioCtx, source, analyser } = makeGraph();
    const monitor = createLevelMonitor(audioCtx, source, () => {});
    assert.deepEqual(source.connectedTo, [analyser], 'wired into the graph on creation');
    assert.equal(analyser.disconnected, 0);
    monitor.stop();
    assert.equal(analyser.disconnected, 1, 'stop() must unwire it again');
  });

  test('stop() ends the frame loop', () => {
    stubRaf();
    const { audioCtx, source } = makeGraph();
    const monitor = createLevelMonitor(audioCtx, source, () => {});
    assert.equal(frames.length, 1, 'the first tick scheduled the next frame');
    monitor.stop();
    frames.pop()(); // the frame already scheduled still runs once
    assert.equal(frames.length, 0, 'and schedules nothing further');
  });

  test('stop() is idempotent and survives an already-torn-down context', () => {
    stubRaf();
    const { audioCtx, source, analyser } = makeGraph();
    analyser.disconnect = () => { throw new Error('context closed'); };
    const monitor = createLevelMonitor(audioCtx, source, () => {});
    monitor.stop();
    monitor.stop();
  });

  test('reports 0 for silence and a clipped 100 for a loud signal', () => {
    stubRaf();
    const levels = [];
    // 128 is the zero point of the unsigned byte time-domain data.
    createLevelMonitor(makeGraph({ sample: 128 }).audioCtx, makeGraph().source, (l) => levels.push(l));
    assert.equal(levels[0], 0);
    const loud = makeGraph({ sample: 255 });
    createLevelMonitor(loud.audioCtx, loud.source, (l) => levels.push(l));
    assert.equal(levels[1], 100, 'the 0..100 scale is clamped');
  });
});
