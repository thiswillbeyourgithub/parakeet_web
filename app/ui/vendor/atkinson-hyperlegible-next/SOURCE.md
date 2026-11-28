# Atkinson Hyperlegible Next (vendored font)

The app's UI font, designed by the Braille Institute for low-vision legibility. Self-hosted because the CSP only allows `font-src 'self'`.

This is a ONE-OFF manual copy, deliberately not pinned in `app/ui/vendor/package.json` and not refreshed by `scripts/update-vendored.sh` (a font has no CVE surface worth a Dependabot watch). The provenance lines below are worded so `test/unit/vendor-manifest.test.mjs` does not mistake this folder for an npm pin; `test/unit/ui-font.test.mjs` checks the file hashes listed here.

- npm package: `@fontsource-variable/atkinson-hyperlegible-next`
- npm version: `5.3.0`
- Tarball: https://registry.npmjs.org/@fontsource-variable/atkinson-hyperlegible-next/-/atkinson-hyperlegible-next-5.3.0.tgz
- Tarball SHA-256: `75d5156505841b7dd4251398f0a5ff9e44120c87c2e388e9a108879b4def23a6`
- Registry integrity (verified against the download): `sha512-UnLzNUy1RWoLDfydAatP4NaRm99X/WbQEph7q/PymJnCFIOOwKOx3pBmp5ys8trO0dM+CKGuJgeZP9fAR4mQpA==`
- Retrieved: 2026-11-28
- Upstream font project: https://github.com/googlefonts/atkinson-hyperlegible-next
- License: SIL Open Font License 1.1 (`LICENSE`, copied from the tarball)

## Files

Copied byte for byte from the tarball's `files/` folder (variable weight axis 200-800, latin + latin-ext subsets, normal + italic):

| File | SHA-256 |
|---|---|
| `atkinson-hyperlegible-next-latin-wght-normal.woff2` | `18b2a1a39a2fa298b0ba5390aca68462669826c90925656f1c1f6796e0e1bbaf` |
| `atkinson-hyperlegible-next-latin-wght-italic.woff2` | `4a5037bfaf6680f40147407407ec09fa42925774bde809a579283d27f9f08106` |
| `atkinson-hyperlegible-next-latin-ext-wght-normal.woff2` | `7dae0c6c66af1aec82e096186aeb1f0e6fa36ab8061ed65422f2b7daf4dd93f3` |
| `atkinson-hyperlegible-next-latin-ext-wght-italic.woff2` | `c0c8da569118e5b2c17032c4f1d0e293271e478fb50d869aefd08fcffdf2042b` |
| `LICENSE` | `474a034e99845062f661855caaa505880d0e9009deddc2727a92795eab374955` |

`fonts.css` is the tarball's `index.css` + `wght-italic.css` concatenated with the `./files/` prefix dropped from each `url()`.

## Refresh procedure

1. Download the new tarball, verify its sha512 against `npm view @fontsource-variable/atkinson-hyperlegible-next@<v> dist.integrity`.
2. Copy `files/*-wght-{normal,italic}.woff2` and `LICENSE` here, regenerate `fonts.css` as above.
3. Update the version, tarball, hash lines and the table in this file, then run `node --test test/unit/ui-font.test.mjs`.

Vendored with Claude Code.
