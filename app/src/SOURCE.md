# Forked parakeet.js

- Package: `parakeet.js`
- Upstream: https://github.com/ysdede/parakeet.js
- Fork-point upstream commit: `441412e6273808c32c91703af4b13d96c4273b20`
  (2025-07-15, upstream version `0.0.3`)
- First post-fork commit in this repo: `6be52cb` ("commit post fork", 2025-12-10)
- License: MIT (see `LICENSE.upstream`). The combined parakeet-web work is
  AGPLv3 (see `../../LICENSE`); MIT continues to apply to the portions
  originating upstream.

Unlike the npm-vendored deps under `app/ui/vendor/`, this is **not** a clean
vendor of an upstream release. The code was forked at upstream v0.0.3 and has
since diverged substantially in both directions, so byte-level pinning
(tarball SHA-256, refresh-from-registry) does not apply here. Treat this
folder as first-party source maintained in-tree.

Imports resolve through the Vite alias `parakeet.js -> app/src/index.js`
(see `../ui/vite.config.js`), so nothing about this folder reaches npm at
install time; the listing in `../package.json` is just metadata.

## Divergence notes

- Upstream is now well past the fork-point (1.4.x at time of writing, with
  new modules such as `long_audio.js` and `sentence_boundary.js` that have
  no equivalent here).
- This fork carries non-trivial changes against the fork-point: refactored
  backend selection, expanded `models.js` registry, encoder/decoder
  quantization controls, deduplicated preprocessor sessions, dynamic
  `blankId` and tokenizer cleanup, plus everything required to integrate
  with the surrounding parakeet-web UI / signaling / Docker stack.
- Because the divergence is two-way, cherry-picking from upstream requires
  reading the relevant upstream commit by hand. There is no automated
  "refresh" path; `scripts/update-vendored.sh` deliberately ignores this
  folder.

## Refresh / sync procedure (manual)

If you want to pull a specific fix from upstream:

1. Identify the upstream commit (`git -C <upstream-clone> log -- src/<file>`).
2. Read the diff between the fork-point commit
   (`441412e6273808c32c91703af4b13d96c4273b20`) and the target commit.
3. Apply by hand, keeping the local refactors intact.
4. Record what you picked in the commit message (`Picks <sha> from upstream`).
5. If you advance the fork-point wholesale, update the SHA + version above.

(Documentation prepared with help from Claude Code.)
