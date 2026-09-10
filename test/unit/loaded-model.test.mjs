// Tier-1 unit test for the sidebar's "Currently loaded" row
// (app/ui/src/lib/loadedModel.js).
//
// This row exists because every OTHER model control in the settings panel shows
// a request rather than an outcome, and the app is allowed to resolve a request
// differently: a precision the source cannot serve falls back, a GPU visitor
// whose deployment ships no GPU encoder is moved to WASM, weights can arrive
// from the local /models mirror instead of HuggingFace. None of that was
// reported anywhere, so a station could sit on a WebGPU selection while an int8
// CPU model did the work.
//
// So the two things pinned here are the two ways this row can fail QUIETLY:
// claiming agreement when the app has in fact diverged (the row then actively
// reassures the visitor of something false), and crying divergence over
// differences they cannot see or did not cause, which trains them to ignore it.
//
// Built with Claude Code.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadedModelDiverges, describeLoadedModel, reconcileSelection } from '../../app/ui/src/lib/loadedModel.js';

const LABELS = { wasm: 'CPU', webgpu: 'GPU', fromHub: 'from HuggingFace', fromLocal: 'from this server' };
const REPO = 'Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx';
const OTHER = 'Olicorne/parakeet-tdt-0.6b-v3-UltiMed-onnx';

const loaded = (over = {}) => ({
  repoId: REPO, backend: 'wasm', encoderQuant: 'int8', servedFrom: 'hf', ...over,
});
const selected = (over = {}) => ({ repoId: REPO, backend: 'wasm', encoderQuant: 'int8', ...over });

describe('loadedModelDiverges: does the running model disagree with the controls', () => {
  test('an exact match is not a divergence', () => {
    assert.equal(loadedModelDiverges(loaded(), selected()), false);
  });

  test('the precision fallback case, which is the whole reason this exists', () => {
    // A visitor on WebGPU whose deployment ships no GPU-runnable encoder is
    // moved to WASM int8. That is correct behaviour, and it must not be silent.
    assert.equal(loadedModelDiverges(
      loaded({ backend: 'wasm', encoderQuant: 'int8' }),
      selected({ backend: 'webgpu-hybrid', encoderQuant: 'fp32' }),
    ), true);
  });

  test('a precision difference alone is a divergence', () => {
    assert.equal(loadedModelDiverges(loaded({ encoderQuant: 'w4a8' }), selected()), true);
  });

  test('a repo difference alone is a divergence', () => {
    // The picker can be changed while a model is loaded; the old one keeps
    // transcribing until a reload, and the transcript never says which model
    // produced it.
    assert.equal(loadedModelDiverges(loaded({ repoId: OTHER }), selected()), true);
  });

  test('the SOURCE is never a divergence', () => {
    // Weights arriving from the local mirror rather than HuggingFace is worth
    // displaying, but it disagrees with nothing the visitor selected. Flagging
    // it would raise the warning on every load of every offline-capable
    // deployment, which teaches people to ignore the warning entirely.
    assert.equal(loadedModelDiverges(loaded({ servedFrom: 'local' }), selected()), false);
  });

  test('an unreported precision claims nothing rather than claiming a mismatch', () => {
    assert.equal(loadedModelDiverges(loaded({ encoderQuant: null }), selected({ encoderQuant: 'fp32' })), false);
  });

  test('nothing loaded, or nothing selected, is not a divergence', () => {
    assert.equal(loadedModelDiverges(null, selected()), false);
    assert.equal(loadedModelDiverges(loaded(), null), false);
  });
});

describe('describeLoadedModel: the line the sidebar renders', () => {
  test('names the backend, the precision and the source, in that order', () => {
    const d = describeLoadedModel(loaded(), selected(), LABELS);
    assert.equal(d.text, 'CPU · int8 · from HuggingFace');
    assert.equal(d.mismatch, false);
  });

  test('a GPU session reads as the GPU label, whichever webgpu flavour it is', () => {
    assert.equal(
      describeLoadedModel(loaded({ backend: 'webgpu-hybrid', encoderQuant: 'fp32' }),
        selected({ backend: 'webgpu-hybrid', encoderQuant: 'fp32' }), LABELS).text,
      'GPU · fp32 · from HuggingFace',
    );
  });

  test('says when the weights came from this server', () => {
    // The offline/blocked-network case: nothing else in the UI would say that
    // HuggingFace was never involved.
    assert.match(describeLoadedModel(loaded({ servedFrom: 'local' }), selected(), LABELS).text,
      /from this server$/);
  });

  test('names the repo only when it is not the selected one', () => {
    assert.equal(describeLoadedModel(loaded(), selected(), LABELS).text.includes(REPO), false);
    const d = describeLoadedModel(loaded({ repoId: OTHER }), selected(), LABELS);
    assert.ok(d.text.endsWith(OTHER), d.text);
    assert.equal(d.mismatch, true);
  });

  test('nothing loaded renders nothing at all', () => {
    // Not an empty row, and above all not a stale one: between a dispose and
    // the next successful load there is no honest answer to give.
    assert.equal(describeLoadedModel(null, selected(), LABELS), null);
  });

  test('a load with no reported precision simply omits it', () => {
    assert.equal(describeLoadedModel(loaded({ encoderQuant: null }), selected(), LABELS).text,
      'CPU · from HuggingFace');
  });
});

describe('reconcileSelection: a fallback must move the controls, not just the console', () => {
  // The stored selection, as persisted (NOT the effective/display value).
  const stored = (over = {}) => ({
    repoId: REPO, backend: 'webgpu-hybrid', wasmEncoderQuant: 'int8', webgpuEncoderQuant: 'fp16', ...over,
  });

  test('writes the precision that really loaded back to the selection', () => {
    // The case this exists for: fp16 was picked, the machine or the source
    // could not honour it, fp32 loaded. The radios already SHOWED fp32 (they
    // display an effective value), so leaving the stored setting on fp16 only
    // meant the saved state disagreed with the screen, reload after reload.
    assert.deepEqual(
      reconcileSelection({ backend: 'webgpu-hybrid', encoderQuant: 'fp32' }, stored()),
      { webgpuEncoderQuant: 'fp32' },
    );
  });

  test('writes to the backend that was loaded, not the other one', () => {
    // Each backend remembers its own precision. Correcting WASM's because a
    // WebGPU load resolved differently would corrupt a setting that was right.
    assert.deepEqual(
      reconcileSelection({ backend: 'wasm', encoderQuant: 'w4a8' },
        stored({ backend: 'wasm', wasmEncoderQuant: 'int8' })),
      { wasmEncoderQuant: 'w4a8' },
    );
  });

  test('an already-agreeing selection is left alone', () => {
    assert.deepEqual(reconcileSelection({ backend: 'webgpu-hybrid', encoderQuant: 'fp16' }, stored()), {});
  });

  test('does nothing when the visitor has already moved the backend radio', () => {
    // The finishing load describes a configuration they have left (moving that
    // radio arms its own reload), so writing to it would undo a choice made a
    // moment ago, and would do it invisibly.
    assert.deepEqual(reconcileSelection({ backend: 'wasm', encoderQuant: 'int8' }, stored()), {});
  });

  test('a load that could not report its precision writes nothing', () => {
    assert.deepEqual(reconcileSelection({ backend: 'webgpu-hybrid', encoderQuant: null }, stored()), {});
  });

  test('never touches the repo', () => {
    // A picker change outlives the loaded model on purpose: reconciling it
    // would silently cancel the switch the visitor just asked for. The
    // "Currently loaded" row reports that divergence instead.
    const fixes = reconcileSelection(
      { backend: 'webgpu-hybrid', encoderQuant: 'fp32', repoId: OTHER }, stored());
    assert.equal('repoId' in fixes, false);
  });

  test('nothing loaded, or nothing stored, writes nothing', () => {
    assert.deepEqual(reconcileSelection(null, stored()), {});
    assert.deepEqual(reconcileSelection({ backend: 'wasm', encoderQuant: 'int8' }, null), {});
  });
});
