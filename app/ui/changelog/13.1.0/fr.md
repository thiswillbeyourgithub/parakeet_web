# 13.1.0 (2026-11-24)

## Téléphone comme micro

- L'appairage ne demande plus de comparer un code : le QR code transporte maintenant un secret que les deux appareils utilisent pour établir le chiffrement, et chaque côté prouve qu'il détient la même clé avant que l'audio ne circule. Une reconnexion se réappaire toute seule.
- Les clés de chiffrement changent toutes les 10 minutes pendant une session, sans couper l'audio : une clé exposée plus tard ne permet pas de déchiffrer l'audio passé.
- Quand les deux navigateurs le permettent, le téléphone envoie son audio compressé en Opus, environ 16 fois plus léger qu'avant. Sinon (par exemple Safari sans WebCodecs, ou un téléphone qui enregistre à 44,1 kHz), il envoie l'audio non compressé comme avant.
- Un téléphone qui décroche brièvement a maintenant 7 secondes pour revenir au lieu de 10, et l'ordinateur renvoie sa clé quand le téléphone revient, ce qui corrige certains appairages qui ne se terminaient jamais.
- Le téléphone et l'ordinateur doivent tous deux utiliser cette version : un onglet plus ancien déjà ouvert doit être rechargé.

## Auto-hébergement

- Le serveur d'appairage accepte plus de connexions par adresse IP, pour les hôpitaux où de nombreux utilisateurs partagent une même adresse publique.
- Les corrections de dictée par défaut suivent maintenant la branche principale du dépôt de regex UltiMed, et le conteneur refuse de démarrer quand une source de regex ou de boost configurée ne donne rien.
