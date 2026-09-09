// Unit tests for the handheld detection behind the "designed for a computer"
// warning. Pure function over a navigator-shaped object, so no browser needed.
//
// Built with Claude Code.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isHandheldDevice } from '../../app/ui/src/lib/deviceClass.js';

const CHROME_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const CHROME_ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36';
const CHROME_ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const SAFARI_IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const FIREFOX_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0';

test('desktop browsers are not handheld', () => {
  assert.equal(isHandheldDevice({ userAgent: CHROME_DESKTOP, userAgentData: { mobile: false } }), false);
  assert.equal(isHandheldDevice({ userAgent: FIREFOX_DESKTOP }), false);
  // A real Mac reports no touch points, unlike an iPad claiming to be one.
  assert.equal(isHandheldDevice({ userAgent: SAFARI_IPADOS, maxTouchPoints: 0 }), false);
});

test('phones are handheld, by client hint or by UA', () => {
  // The hint alone is enough, even on a UA that says nothing.
  assert.equal(isHandheldDevice({ userAgent: '', userAgentData: { mobile: true } }), true);
  assert.equal(isHandheldDevice({ userAgent: CHROME_ANDROID_PHONE, userAgentData: { mobile: true } }), true);
  // Safari and Firefox expose no userAgentData at all, so the UA must carry it.
  assert.equal(isHandheldDevice({ userAgent: SAFARI_IPHONE }), true);
  assert.equal(isHandheldDevice({ userAgent: FIREFOX_ANDROID }), true);
});

test('tablets are handheld even though the client hint says mobile:false', () => {
  // An Android tablet reports mobile:false; the UA "Android" token is what
  // catches it, which is exactly why a false hint must not short-circuit.
  assert.equal(isHandheldDevice({ userAgent: CHROME_ANDROID_TABLET, userAgentData: { mobile: false } }), true);
  // iPadOS 13+ hides behind a Macintosh UA and is only betrayed by touch.
  assert.equal(isHandheldDevice({ userAgent: SAFARI_IPADOS, maxTouchPoints: 5 }), true);
});

test('an unreadable navigator stays quiet rather than nagging', () => {
  assert.equal(isHandheldDevice(null), false);
  assert.equal(isHandheldDevice(undefined), false);
  assert.equal(isHandheldDevice({}), false);
  assert.equal(isHandheldDevice({ userAgent: 42 }), false);
  const hostile = { get userAgent() { throw new Error('nope'); } };
  assert.equal(isHandheldDevice(hostile), false);
});
