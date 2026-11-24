# 13.1.0 (2026-11-24)

## Phone as a microphone

- Pairing no longer asks you to compare a code: the QR code now carries a secret that both devices use to set up encryption, and each side proves it holds the same key before any audio flows. A reconnect pairs again on its own.
- Encryption keys change every 10 minutes during a session, without pausing the audio, so a key exposed later cannot decrypt earlier audio.
- When both browsers support it, the phone sends its audio compressed with Opus, about 16 times smaller than before. Otherwise (for example Safari without WebCodecs, or a phone recording at 44.1 kHz) it sends uncompressed audio as before.
- A phone that drops out briefly is now given 7 seconds to come back instead of 10, and the computer re-sends its key when the phone rejoins, which fixes some pairings that never completed.
- The phone and the computer must both run this version: an older open tab has to be reloaded.

## Self-hosting

- The pairing server allows more connections per IP address, for hospitals where many users share one public address.
- The default dictation corrections now follow the UltiMed regex repository's main branch, and the container refuses to start when a configured regex or boost source yields nothing.
