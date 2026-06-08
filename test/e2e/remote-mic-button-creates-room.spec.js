// Tier-3 E2E regression: clicking the "Phone Mic" button must MINT A NEW ROOM
// (the createRoom path), not take the re-arm path.
//
// The bug: the button was wired as `onClick={startRemoteMic}`, so Preact passed
// the click PointerEvent as startRemoteMic's `existingRoom` argument. A truthy
// `existingRoom` sends the function down the reconnect branch, which calls
// `rtc.adoptRoom(existingRoom.roomId, existingRoom.secret)` (both undefined) and
// then `rearmRoom()` -> `POST /api/signal/rooms/undefined/rearm` with no
// X-Room-Secret header -> HTTP 401. The catch then drops the modal straight to
// the 'disconnected' ("Phone disconnected") state on the very first click, so
// the user had to hit "regenerate QR" before a code ever appeared. The fix is
// `onClick={() => startRemoteMic()}` so no argument is forwarded.
//
// This test never runs a real signaling server: it fakes the /api/signal/*
// endpoints just enough for createRoom + createOfferAndStore to reach the
// 'waiting' (QR shown) state, holds the answer long-poll open, and asserts (a)
// the QR/"waiting" UI appears, (b) the "Phone disconnected" UI never does, and
// (c) no signaling request was ever made to a `/rearm` or `/undefined/` path.
//
// It still needs a loaded model because the Phone Mic button is gated on
// `modelLoaded`; the model load (local int8 WASM weights) is the only slow part.
//
// Built with Claude Code.

import { test, expect } from '@playwright/test';
import { seedSettings } from './seed.mjs';

test('Phone Mic button mints a new room instead of re-arming (no spurious "Phone disconnected")', async ({ page }) => {
  const signalUrls = [];
  // Fake the signaling server. One handler switches on method+path; anything we
  // don't explicitly answer (notably the /answer long-poll) is left pending so
  // the app parks in 'waiting' exactly as it would against a real server with no
  // phone yet. Every request URL is recorded so we can assert the path taken.
  await page.route('**/api/signal/**', async (route) => {
    const req = route.request();
    const url = req.url();
    signalUrls.push(url);
    const path = new URL(url).pathname;

    if (path.endsWith('/config')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ iceServers: [] }) });
      return;
    }
    if (req.method() === 'POST' && path.endsWith('/api/signal/rooms')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ roomId: 'TST123', secret: 'sekret' }) });
      return;
    }
    if (req.method() === 'POST' && (path.endsWith('/offer') || path.includes('/ice/'))) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      return;
    }
    if (path.includes('/answer')) {
      // The phone never joins: hold the long-poll open so the app stays in
      // 'waiting'. Left pending on purpose; Playwright tears it down at test end.
      return;
    }
    // Any other signal call (including the bug's /rearm) gets a 401, mirroring
    // the real server's validateRoomSecret on an unknown room.
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid room secret' }) });
  });

  // Bring up a loaded model (same preamble as transcription.spec.js).
  await page.goto('/');
  await seedSettings(page);
  await page.reload();
  await page.locator('[data-umami-event="load_model_button"]').click();
  await expect(page.locator('body')).toContainText('✔', { timeout: 6 * 60 * 1000 });

  // Click "Phone Mic". With the fix this calls startRemoteMic() with no args.
  await page.getByRole('button', { name: 'Phone Mic' }).click();

  // The modal must reach the QR/"waiting" state, proving createRoom + offer
  // succeeded. With the bug it would instead show "Phone disconnected".
  await expect(page.getByText('Scan this QR code with your phone')).toBeVisible({ timeout: 30 * 1000 });
  await expect(page.getByText('Phone disconnected')).toHaveCount(0);

  // The create-room call must have happened, and NOTHING may have hit the
  // re-arm endpoint or an `undefined`-room path (the bug's signature).
  expect(signalUrls.some((u) => /\/api\/signal\/rooms$/.test(new URL(u).pathname)),
    `expected a POST /api/signal/rooms; saw: ${signalUrls.join(', ')}`).toBe(true);
  expect(signalUrls.filter((u) => u.includes('/rearm') || u.includes('/undefined/')),
    'no signaling request may target /rearm or an undefined room').toHaveLength(0);
});
