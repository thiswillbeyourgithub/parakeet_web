# 11.4.0 (2026-09-30)

## Les noms de médicaments mal entendus peuvent être corrigés

Un nouveau réglage **Corriger les noms de médicaments mal entendus** (section Général, activé par le mode dictée médicale, mémorisé sinon) ajoute un affichage **Médicaments** à droite de **Brut** sur chaque transcription. Il réécrit les noms de médicaments que le modèle entend comme des mots ordinaires (« l'ananas de l'umab » devient « lanadelumab ») avec 14 377 règles apprises sur les erreurs de noms de médicaments des modèles UltiMed et parakeet-ultra sur tous les splits du sous-ensemble médicaments d'UltiMed, et il passe avant les regex de la Dictée. Les règles ne modifient aucune des 602 813 étiquettes correctes de ce jeu de données ni aucune de 1 662 transcriptions VoxPopuli en français. Les règles sont livrées avec l'application, elles fonctionnent donc avec n'importe quel modèle, et elles sont livrées compilées : 190 Ko tels que servis, téléchargés seulement une fois le réglage activé, chaque regex n'étant construite que la première fois qu'une transcription contient son mot. Indexées par mot, elles coûtent environ 0,11 ms par transcription (mesuré sous Node sur les règles livrées) au lieu de 19 ms appliquées une à une, pour le même résultat.

Écrit avec Claude Code.

## Ultra devient le modèle par défaut

Sans modèle configuré, l'application, les outils en ligne de commande et l'image Docker chargent désormais [Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx) au lieu de [Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx). Sur la partition de validation FLEURS complète de 25 langues (glouton, encodeur int8), cela fait 11,57 % de WER macro contre 13,14 %. Les deux dépôts ont la même organisation et des fichiers de même taille, donc le téléchargement ne change pas. Le déploiement de référence ne propose plus le modèle optimized ; un visiteur qui l'avait choisi retombe sur le nouveau modèle par défaut. L'identifiant de modèle par défaut du serveur compatible OpenAI suit, de `parakeet-tdt-0.6b-v3-int8` à `parakeet-tdt-0.6b-v3-ultra-int8`.

Rédigé avec Claude Code.

## La précision « int8 lite » disparaît

La précision d'encodeur « int8 lite » a été retirée des réglages, du chargeur et des outils : aucun des modèles proposés par l'application ne fournit plus cette version, ce choix ne pouvait donc aboutir qu'à un bandeau « indisponible ». Un navigateur qui avait encore int8 lite enregistré d'une visite précédente charge désormais int8.

Rédigé avec Claude Code.

## Deux modèles de plus : parakeet-ultra et parakeet-redux

Le sélecteur de modèle peut désormais proposer des exports ONNX de [moondream/parakeet-ultra](https://huggingface.co/moondream/parakeet-ultra) et de [moondream/parakeet-redux](https://huggingface.co/moondream/parakeet-redux), publiés sous [Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx) et [Olicorne/parakeet-tdt-0.6b-v3-redux-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-redux-onnx), et le déploiement de référence les liste après le modèle par défaut et UltiMed (`?model=ultra`, `?model=redux`). Le modèle par défaut ne change pas. Tous deux n'étaient publiés qu'au format `transformers` : ils sont donc reconvertis en NeMo puis construits exactement comme le modèle par défaut, toutes précisions comprises. Sur la partition de validation FLEURS complète (25 langues, décodage glouton, encodeur int8), le WER macro vaut 13,14 % pour le modèle par défaut, 11,57 % pour Ultra et 12,64 % pour Redux. En faisceau de 5 (60 extraits par langue), Ultra atteint 10,65 % et Redux 11,72 %. Sur les deux modèles, int8 ne coûte rien de mesurable face à fp32 (Ultra 11,55 %, Redux 12,64 %), et les deux tiennent sur un passage unique de 390 s comme de 607 s. Les tableaux complets sont dans le README de chaque dépôt de modèle.

Rédigé avec Claude Code.

## Un encodeur sur 2 bits pour les modèles à poids ternaires

Les poids de l'encodeur de Redux sont ternaires : dans chaque bloc de 128, chaque poids vaut -a, 0 ou +a. Deux bits suffisent à les représenter exactement, donc une nouvelle précision **w2a8** les encode sans aucune perte, et son encodeur pèse 190 Mo contre 643 Mo pour int8. Sur la partition de validation FLEURS complète, elle obtient 12,64 % de WER macro, autant que Redux en int8 et en fp32 (les scores par langue diffèrent, les moyennes concordent à 0,003 point près), et 5,5 % contre 5,4 % pour int8 au test de dérive sur audio long. Elle fonctionne sur la voie processeur comme sur la voie carte graphique, et comme toute précision elle n'est proposée que là où la source de modèles héberge réellement le fichier : elle apparaît donc pour Redux et nulle part ailleurs.

Rédigé avec Claude Code.

## Le moteur de transcription passe à ONNX Runtime 1.30

Le moteur ONNX Runtime Web embarqué (le runtime par lequel passe chaque transcription, aussi bien sur le processeur que sur la carte graphique) passe de 1.29.0 à 1.30.0, la version stable la plus récente publiée sur npm. C'est de l'entretien plutôt que de la vitesse : un A/B entrelacé de 1.30 contre 1.29 dans le navigateur, sur le clip de référence du projet, les avait déjà mesurées indistinguables au bruit près sur les deux chemins, et la nouveauté mise en avant par 1.30 côté carte graphique est un jeu de noyaux matriciels écrits en demi-précision, qu'une carte doit déclarer prendre en charge avant qu'ils puissent seulement s'exécuter. L'ensemble des fichiers téléchargés par un visiteur, et le contrôle d'intégrité auquel ils sont soumis à l'arrivée, ne changent pas.

Rédigé avec Claude Code.

## Un fichier moteur refusé ne garde plus le runtime en mémoire

Les deux fichiers du moteur sont téléchargés et vérifiés par empreinte côte à côte. Quand l'un échouait à sa vérification, l'autre pouvait terminer un instant plus tard et confier au navigateur une référence vers ses octets que rien ne libérait jamais, gardant tout le runtime (environ 16 Mo pour la plus grosse moitié) en mémoire tant que la page restait ouverte. Le nettoyage attend désormais que les deux moitiés aient terminé avant de s'exécuter.

Cela n'arrivait que sur le chemin d'un chargement de toute façon refusé, donc personne n'a transcrit moins bien à cause de cela. Cela mérite d'être consigné parce que c'est exactement ce que le test couvrant ce code avait été écrit pour empêcher, et que le test était d'accord avec le code jusqu'au jour où une machine chargée a changé le minutage.

Rédigé avec Claude Code.

## La barre de téléchargement ne fait plus de va-et-vient

Sur une machine équipée d'une carte graphique, cliquer sur Charger le modèle lance d'abord un court test de vitesse pour choisir entre le processeur et la carte graphique. Ce test dure quelques secondes, et pendant ce temps le bouton Charger le modèle restait affiché et cliquable. Un second clic à ce moment lançait aussitôt un chargement, puis le test de vitesse en lançait un autre en se terminant : le même modèle était téléchargé deux fois en parallèle. Les deux téléchargements alimentaient la même barre de progression, qui sautait sans cesse entre leurs deux pourcentages. Un second clic (ou le raccourci Espace/Entrée) est désormais ignoré tant qu'une demande de chargement est en cours, et le modèle n'est téléchargé qu'une fois.

Écrit avec Claude Code.
