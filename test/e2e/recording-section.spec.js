// Tier-3 E2E for the sidebar's Recording group, which had no direct coverage
// of any kind: nothing drove noise suppression, auto gain, live transcription
// or its context window, so the whole group could have been wired to the wrong
// setting keys and every other spec would still have passed.
//
// Two things are worth pinning here, and they are different in kind:
//
//  1. The four controls restore from storage and persist a UI edit. This is
//     plain settings plumbing and needs no microphone.
//  2. The capture-shaping controls are DISABLED while a recording runs. That is
//     not cosmetic: noiseSuppression/autoGainControl are read once, when
//     getUserMedia opens the stream (see startRecordingCountdown), so a control
//     that stayed live mid-take would report a state the running capture is not
//     in. Live transcription and its window are locked for the same reason (the
//     live transcriber is started with the stream).
//
// The second test needs a real getUserMedia, so this file (and only this file)
// launches Chromium with a fake audio device. No model is loaded: recording
// needs only the microphone, and the stopped take just lands in the capture
// queue, which is a supported state covered by its own specs.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings, expandSettingsSection, readSetting } from './seed.mjs';

// A fake audio device, so getUserMedia resolves without a real one and without
// a permission prompt. Scoped to this file: no other spec in the tier touches
// the microphone, and the tier's Chromium should stay as close to a visitor's
// as possible everywhere else. It has to sit at file level, not around the one
// test that needs it: launchOptions forces a new worker, which Playwright only
// allows per file.
test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  permissions: ['microphone'],
});

const checkbox = (page, label) =>
  page.locator('label', { hasText: label }).locator('input[type="checkbox"]');

const contextWindow = (page) =>
  page.locator('.setting-row', { hasText: 'Context window' }).locator('select');

async function openRecordingSection(page) {
  await page.locator('.settings-toggle').click();
  await expandSettingsSection(page, 'Recording');
}

test('the Recording controls restore from storage and persist UI edits', async ({ page }) => {
  // Seed the opposite of every default (noise suppression and auto gain
  // default ON, live transcription OFF, window 'auto') so a control wired to
  // the wrong key, or not wired at all, cannot accidentally agree.
  await page.goto('/');
  await seedSettings(page, {
    noiseSuppression: false,
    autoGainControl: false,
    liveTranscriptionEnabled: true,
    liveContextWindow: '30',
  });
  await page.reload();
  await openRecordingSection(page);

  await expect(checkbox(page, 'Noise Suppression')).not.toBeChecked();
  await expect(checkbox(page, 'Auto Gain Control')).not.toBeChecked();
  await expect(checkbox(page, 'Live transcription')).toBeChecked();
  await expect(contextWindow(page)).toHaveValue('30');

  // Flip each one through the UI and confirm the write reaches storage.
  await checkbox(page, 'Noise Suppression').check();
  await checkbox(page, 'Auto Gain Control').check();
  await contextWindow(page).selectOption('15');
  await expect.poll(() => readSetting(page, 'noiseSuppression')).toBe(true);
  await expect.poll(() => readSetting(page, 'autoGainControl')).toBe(true);
  await expect.poll(() => readSetting(page, 'liveContextWindow')).toBe('15');

  // The context window belongs to live transcription: turning that off hides
  // it, and turning it back on brings it back with the edited value intact.
  await checkbox(page, 'Live transcription').uncheck();
  await expect(contextWindow(page)).toHaveCount(0);
  await expect.poll(() => readSetting(page, 'liveTranscriptionEnabled')).toBe(false);
  await checkbox(page, 'Live transcription').check();
  await expect(contextWindow(page)).toHaveValue('15');

  // And the whole group survives a reload.
  await page.reload();
  await openRecordingSection(page);
  await expect(checkbox(page, 'Noise Suppression')).toBeChecked();
  await expect(checkbox(page, 'Auto Gain Control')).toBeChecked();
  await expect(checkbox(page, 'Live transcription')).toBeChecked();
  await expect(contextWindow(page)).toHaveValue('15');
});

test('the capture-shaping controls lock while a recording runs, and unlock after', async ({ page }) => {
  // Hold the model listing pending forever: the capture controls only exist
  // once a load is under way (see controls-available-during-load.spec.js), but
  // recording itself needs no weights, so this reaches a real recording without
  // downloading one.
  await page.route(/huggingface\.co/, () => { /* keep the request pending */ });
  await page.goto('/');
  await seedSettings(page, { liveTranscriptionEnabled: true });
  await page.reload();

  await page.locator('[data-umami-event="load_model_button"]').click();
  const record = page.locator('[data-umami-event="record_button"]');
  await expect(record).toBeVisible({ timeout: 30_000 });

  const locked = () => [
    checkbox(page, 'Noise Suppression'),
    checkbox(page, 'Auto Gain Control'),
    checkbox(page, 'Live transcription'),
    contextWindow(page),
  ];
  const closeSidebar = () => page.locator('.settings-sidebar-close').click();

  await openRecordingSection(page);
  for (const c of locked()) await expect(c).toBeEnabled();
  await closeSidebar();

  // There is a ~1 s countdown between the click and the take, so wait for the
  // Stop button rather than for the click to return.
  await record.click();
  const stop = page.locator('[data-umami-event="stop_record_button"]');
  await expect(stop).toBeVisible({ timeout: 30_000 });

  // These are applied when the stream is opened, so they must not look
  // changeable while that stream is live.
  await openRecordingSection(page);
  for (const c of locked()) await expect(c).toBeDisabled();
  await closeSidebar();

  await stop.click();
  await openRecordingSection(page);
  for (const c of locked()) await expect(c).toBeEnabled({ timeout: 30_000 });
});
