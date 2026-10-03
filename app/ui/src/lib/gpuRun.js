// The WebGPU rendering-coupling guard, shared by every WebGPU workload: an
// animating page gates WebGPU callback delivery process-wide, so each JSEP
// yield inside session.run waits on frame production (measured ~50x on the
// fp32 encoder, 2026-08-11; see CLAUDE.md). `html.gpu-run` pauses every CSS
// animation (App.css) for as long as at least one WebGPU run holds it.
//
// Depth-counted so overlapping holders (a transcription, the autoconfigure
// probe, a diarization) never unpause each other early. The counter used to
// be a ref in App.jsx with the add/remove pair written out at each call site;
// diarization needing a third copy is what moved it here.
//
// Built with Claude Code.

let depth = 0;

/**
 * Pause page animations until the returned release function is called.
 * Releasing twice is harmless (the second call is a no-op), so a release in
 * a `finally` cannot double-decrement after an earlier explicit release.
 *
 * @param {{classList: {add: Function, remove: Function}}} [root] element
 *   carrying the class; injectable for the unit test.
 * @returns {() => void} release
 */
export function acquireGpuRun(root = document.documentElement) {
  depth += 1;
  root.classList.add('gpu-run');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0) root.classList.remove('gpu-run');
  };
}
