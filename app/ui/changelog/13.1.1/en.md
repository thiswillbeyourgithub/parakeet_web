# 13.1.1 (2026-11-24)

## Phone mic

- Opus recordings from the phone decode correctly again: Chromium decodes Opus at 48 kHz whatever rate was announced, and the computer now converts it back.
- If the computer still cannot decode a phone's Opus audio, it asks the phone to resend it as plain PCM, so the recording is not lost.
- Refusing the microphone on the phone no longer ends the session: you stay connected and can still send an audio file.
- The phone's record button is now a large round button, and the other buttons are bigger and better spaced.
