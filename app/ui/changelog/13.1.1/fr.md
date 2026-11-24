# 13.1.1 (2026-11-24)

## Micro du téléphone

- Les enregistrements Opus du téléphone sont de nouveau décodés correctement : Chromium décode l'Opus en 48 kHz quel que soit le débit annoncé, et l'ordinateur le reconvertit désormais.
- Si l'ordinateur n'arrive toujours pas à décoder l'Opus d'un téléphone, il demande au téléphone de le renvoyer en PCM brut, et l'enregistrement n'est pas perdu.
- Refuser le micro sur le téléphone ne met plus fin à la session : vous restez connecté et pouvez toujours envoyer un fichier audio.
- Le bouton d'enregistrement du téléphone est maintenant un grand bouton rond, et les autres boutons sont plus grands et mieux espacés.
