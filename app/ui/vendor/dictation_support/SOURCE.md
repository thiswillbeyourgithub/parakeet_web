# Vendored dictation_support

- Package: `dictation_support` (GoogleChromeLabs/dictation_support)
- Version: `1.0.5` (synthesised as `1.0.5-vendored` in `package.json`)
- Source: https://github.com/GoogleChromeLabs/dictation_support
- Upstream commit: `90e7a51198477637f512c0bb73a711cd8acc3466`
  (tagged `v1.0.5` at https://github.com/GoogleChromeLabs/dictation_support)
  Resolved from the GitHub tags API on 2026-05-12. The exact commit SHA is
  the load-bearing pin: a future contributor (or anyone with commit access)
  could swap `dist/index.js` with a tampered build, and only the upstream
  commit SHA lets a reviewer reproduce the build and verify byte-for-byte.
- File SHA-256 (the load-bearing pin used by code review to detect tampering):
  - `dist/index.js`: `36d49ea6f865c599023fbf6af67f12d66b3ca2afe1b9162945a091411e80cf19`
  - `dist/index.d.ts`: `aef77096228115c11bb07b1a3cdd424023710d428aba5950a8a1756fa9247ef6`
- License: Apache-2.0 (see `LICENSE`)

Vendored to keep the UI's runtime supply chain auditable: no install-time fetch,
no transitive deps, fixed bytes on disk. Aliased into the build via
`app/ui/vite.config.js` (`{ find: /^dictation_support$/ }`).

Used (bundled) files only:
- `dist/index.js`
- `dist/index.d.ts`

Why this manifest matters: the upstream package is git-only and has no npm
hash to compare against. Without a recorded byte-level pin, a future
contributor (or anyone with commit access) could swap `dist/index.js` with
a tampered build that intercepts WebHID events from the Philips SpeechMike
(microphone-button presses, audio routing) and silently forwards them to a
third party. `npm audit`, dependabot, and renovate do not look at vendored
files. Recompute the SHA-256s above on every refresh and reject diffs that
were not preceded by a corresponding commit-SHA bump.

To refresh (MANDATORY: pin the commit SHA, do not skip step 5):
1. Clone the upstream repo and check out the desired commit (record its
   full 40-char SHA NOW; you will need it in step 5).
2. Build per upstream instructions (produces `dist/index.js` and
   `dist/index.d.ts`).
3. Replace the contents of `dist/` here.
4. Recompute `sha256sum dist/index.js dist/index.d.ts` and update the
   `dist/index.js` / `dist/index.d.ts` lines above.
5. Update the upstream commit SHA above to the one you built from.
   This is the only durable anchor for byte-level review; refreshes that
   skip this step are vendor-tree tampering even when well-intentioned.

(Vendoring prepared with help from Claude Code.)
