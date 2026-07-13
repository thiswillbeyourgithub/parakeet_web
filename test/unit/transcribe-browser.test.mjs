// Tier-1 unit tests for the PURE logic of scripts/transcribe-browser.mjs: arg
// parsing (defaults + validation) and the Markdown builders. The browser-driving
// path itself is WebGPU/GPU-gated and out of CI, exactly like webgpu-check.mjs
// (headless CI has no GPU and no diarization models), so only the pure pieces are
// unit-testable here. Importing the module must NOT launch anything: the CLI body
// is guarded behind an `invokedDirectly` check.
//
// Built with Claude Code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseArgs, defaultOutPath, turnsToMarkdown, buildMarkdown,
} from '../../scripts/transcribe-browser.mjs';

test('parseArgs: defaults match the high-quality WebGPU recipe', () => {
  const a = parseArgs(['clip.ogg']);
  assert.equal(a.audio, 'clip.ogg');
  assert.equal(a.backend, 'webgpu-hybrid');
  assert.equal(a.quant, 'fp32');
  assert.equal(a.beamWidth, 5);
  assert.equal(a.diarize, true);
  assert.equal(a.numSpeakers, 2);
  assert.equal(a.headless, false);
  assert.equal(a.channel, 'chromium');
  assert.equal(a.out, 'clip.md'); // default derived from the audio basename
});

test('parseArgs: flags override defaults (space and = forms)', () => {
  const a = parseArgs(['x.wav', '-w', '8', '-n', '3', '-o', 'out.md', '--backend=wasm', '--quant=int8']);
  assert.equal(a.beamWidth, 8);
  assert.equal(a.numSpeakers, 3);
  assert.equal(a.out, 'out.md');
  assert.equal(a.backend, 'wasm');
  assert.equal(a.quant, 'int8');
});

test('parseArgs: --no-diarize disables diarization', () => {
  const a = parseArgs(['x.wav', '--no-diarize']);
  assert.equal(a.diarize, false);
});

test('parseArgs: --help returns early without requiring an audio arg', () => {
  const a = parseArgs(['--help']);
  assert.equal(a.help, true);
  assert.equal(a.audio, null);
});

test('parseArgs: validation errors', () => {
  assert.throws(() => parseArgs([]), /No audio file given/);
  assert.throws(() => parseArgs(['a.wav', '--backend', 'cuda']), /--backend must be/);
  assert.throws(() => parseArgs(['a.wav', '--quant', 'bogus']), /--quant must be/);
  assert.throws(() => parseArgs(['a.wav', '-w', '0']), /--beam-width must be/);
  assert.throws(() => parseArgs(['a.wav', '-w', '11']), /--beam-width must be/);
  assert.throws(() => parseArgs(['a.wav', '-n', '-1']), /--num-speakers must be/);
  assert.throws(() => parseArgs(['a.wav', '-n', '11']), /--num-speakers must be/);
  assert.throws(() => parseArgs(['a.wav', '--timeout-min', '0']), /--timeout-min must be/);
  assert.throws(() => parseArgs(['a.wav', 'b.wav']), /Unexpected extra argument/);
  assert.throws(() => parseArgs(['a.wav', '--nope']), /Unknown option/);
});

test('defaultOutPath: swaps the extension for .md', () => {
  assert.equal(defaultOutPath('a/b/clip.ogg'), 'a/b/clip.md');
  assert.equal(defaultOutPath('noext'), 'noext.md');
  assert.equal(defaultOutPath('dotted.name.wav'), 'dotted.name.md');
});

test('turnsToMarkdown: formats turns, drops empty text, defaults the speaker', () => {
  const md = turnsToMarkdown([
    { speaker: 'Speaker 1', text: 'hello there' },
    { speaker: 'Speaker 2', text: '' },      // dropped: no text
    { speaker: '', text: 'anon line' },       // default label
    { speaker: 'Speaker 1', text: '  spaced  ' },
  ]);
  assert.equal(md,
    '**Speaker 1:** hello there\n\n'
    + '**Speaker:** anon line\n\n'
    + '**Speaker 1:** spaced');
});

test('buildMarkdown: diarized header + body', () => {
  const md = buildMarkdown({
    audio: '/tmp/chat.ogg', backend: 'webgpu-hybrid', quant: 'fp32',
    beamWidth: 5, numSpeakers: 2, diarized: true, generatedAt: '2026-07-13T00:00:00.000Z',
  }, '**Speaker 1:** hi');
  assert.match(md, /^# Transcript: chat\n/);
  assert.match(md, /- Source: chat\.ogg\n/);
  assert.match(md, /- Backend: webgpu-hybrid \(encoder fp32\), beam width 5, no phrase boost\n/);
  assert.match(md, /- Speakers: 2 \(diarized\)\n/);
  assert.match(md, /- Generated with Claude Code/);
  assert.match(md, /\*\*Speaker 1:\*\* hi\n$/);
});

test('buildMarkdown: auto speaker count and non-diarized line', () => {
  const auto = buildMarkdown({
    audio: 'c.ogg', backend: 'webgpu-hybrid', quant: 'fp32',
    beamWidth: 5, numSpeakers: 0, diarized: true, generatedAt: 't',
  }, 'x');
  assert.match(auto, /- Speakers: auto \(diarized\)\n/);

  const plain = buildMarkdown({
    audio: 'c.ogg', backend: 'wasm', quant: 'int8',
    beamWidth: 1, numSpeakers: 2, diarized: false, generatedAt: 't',
  }, 'x');
  assert.match(plain, /- Speakers: not diarized\n/);
});
