// Pure handheld (phone/tablet) detection behind the "designed for a computer"
// warning popup.
//
// Why it exists: the app downloads hundreds of megabytes of weights, holds them
// in memory and runs the speech engine on the device's own CPU/GPU. That is a
// desktop workload: a phone or tablet typically has neither the memory headroom
// nor the sustained clock for it, and a browser tab that goes to the background
// on mobile is suspended mid-transcription. Visitors deserve that heads-up
// BEFORE they start a ~600 MB download, so App.jsx shows a dismissable (never
// persisted) popup, exactly like the slow-browser one in browserFamily.js.
//
// It also gates a second warning: on a handheld, "Phone Mic" is offering to
// pair a phone with the machine running the model, which is the device the
// visitor is already holding. That feature exists for a COMPUTER with no
// microphone, so on a handheld it needs saying out loud.
//
// Detection, in order of preference:
// 1. userAgentData.mobile === true: the honest signal, exposed by Chromium.
//    It is phone-only though (an Android tablet reports false), so a true
//    answer is trusted and a false one falls through rather than concluding.
// 2. UA-string matching for phones and tablets, which covers the tablets
//    client hints miss, plus Firefox and Safari, which do not implement
//    userAgentData at all.
// 3. iPadOS 13+ deliberately claims to be a Mac ("Macintosh" UA, no "iPad"),
//    and the only thing separating it from a real desktop Safari is that it
//    reports touch points.
// Unknown/absent navigator resolves to false (do not nag when we cannot tell:
// e.g. tests or exotic embedders), the same "stay quiet when unsure" rule
// isChromiumFamily uses.
//
// Written with the help of Claude Code.

export function isHandheldDevice(nav) {
  try {
    if (!nav) return false;

    // 1. Client hint. Only conclusive when true.
    const uaData = nav.userAgentData;
    if (uaData && uaData.mobile === true) return true;

    const ua = typeof nav.userAgent === 'string' ? nav.userAgent : '';

    // 3. iPadOS 13+ masquerading as macOS: a desktop Mac reports no touch.
    if (/Macintosh/i.test(ua) && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 1) {
      return true;
    }

    if (!ua) return false;

    // 2. Phones and tablets by UA. "Android" alone covers Android tablets,
    //    which carry it without the "Mobile" token phones add.
    return /Android|iPhone|iPod|iPad|Windows Phone|IEMobile|BlackBerry|BB10|Opera Mini|Mobile Safari|Silk\/|Kindle|PlayBook|webOS/i.test(ua);
  } catch {
    return false;
  }
}
