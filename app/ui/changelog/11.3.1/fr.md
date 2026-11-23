# 11.3.1 (2026-09-11)

## Une précision de modèle nouvellement publiée apparaît enfin

Quand un opérateur ajoute un encodeur à son serveur de modèles (du fp16, par exemple), il publie le fichier et s’attend à le voir apparaître. Ce n’était pas le cas pendant une journée entière, et l’échec était pire qu’une simple absence : la précision était annoncée comme « non hébergée par cette source de modèle », et un chargement qui la demandait sur le GPU signalait que ce déploiement ne pouvait pas la servir, puis basculait le navigateur sur le processeur, définitivement, en mémorisant la décision.

La cause était une règle de cache. Le serveur décrit son propre répertoire de modèles dans un petit fichier placé à côté des poids, et ce fichier était mis en cache pour une journée au même titre que les poids eux-mêmes, qui eux ne changent pas. Un visiteur de retour conservait donc une description écrite avant l’existence du nouvel encodeur, sans jamais en redemander une fraiche. Ouvrir le même site dans une fenêtre privée, sans rien en cache, le montrait fonctionnel : de quoi y perdre un après-midi.

Ce fichier est désormais revalidé à chaque chargement, des deux côtés : le serveur cesse de demander aux navigateurs de le conserver, et l’application cesse d’accepter une copie conservée. Ceux que leur navigateur avait déjà basculés sur le processeur à cause de cela reviennent sur le GPU dès la visite suivante, car l’application abandonne maintenant cette décision dès que le serveur propose à nouveau la précision.

La même règle de fraicheur couvre désormais la liste de fichiers lue sur Hugging Face, pour la même raison : c’est elle qui décide des précisions dont l’application croit qu’elles existent.

Écrit avec Claude Code.

## La liste des précisions décrit votre déploiement, pas l’application

La liste des précisions d’encodeur affichait toutes les précisions connues de l’application et grisâit celles qui étaient inutilisables, avec une courte raison. Deux de ces raisons ne méritaient pas une ligne. Une précision que le moteur sélectionné ne prend pas en charge n’a jamais été un choix, et voir fp16 grisé sous le moteur processeur se lisait comme un fichier manquant plutôt que comme un moteur qui n’en a aucun usage. Une précision que le serveur de modèles n’héberge pas appartient au déploiement de quelqu’un d’autre.

Les deux sont désormais simplement absentes. Reste le cas où le fichier est bien là, le moteur le prend en charge, et c’est votre carte graphique qui ne peut pas l’exécuter : cette ligne subsiste, grisée, et le dit, car votre matériel est seul en cause et la masquer laisserait deux machines afficher des listes différentes sans explication.

En pratique, la liste suit ce qu’un dépôt de modèles publie réellement : servir un autre jeu de fichiers ONNX devient une simple question de publication.

Écrit avec Claude Code.

## La mesure de votre machine est mémorisée, sauf si le jeu de modèles a changé

La mesure ponctuelle qui tranche entre le processeur et la carte graphique est conservée pour ne pas être refaite à chaque visite, et elle était déjà rattachée à la version de l’application et à l’adaptateur mesuré. Elle ne l’était pas à ce que le serveur de modèles pouvait servir, qui est pourtant ce à quoi la réponse sert. Une machine mesurée face à un déploiement qui n’avait rien à offrir à sa carte graphique passait sur le processeur et y restait quatre-vingt-dix jours, même après la publication de l’encodeur manquant.

La réponse conservée enregistre désormais ce qui était proposé à ce moment-là, et un changement déclenche une nouvelle mesure, une seule fois. Un déploiement qui ne publie aucune description de lui-même ne change pas : faute de comparaison possible, la réponse conservée est gardée plutôt que remesurée à chaque chargement.

Écrit avec Claude Code.
