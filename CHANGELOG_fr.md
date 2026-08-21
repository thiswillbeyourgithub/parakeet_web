# Journal des modifications

**[English](./CHANGELOG.md) | [Français](./CHANGELOG_fr.md)**

Changements notables de Parakeet Web. Ce fichier commence à la version 10.0.0 ; les versions antérieures ne sont consignées que dans l'historique git.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).

---

## 10.0.0 (2026-08-21)

Un seul fil conducteur traverse toute cette version : **tirer le maximum de vitesse d'un matériel ordinaire, et cesser de supposer où se trouve cette vitesse**. Presque chaque changement ci-dessous est parti d'une mesure qui contredisait une supposition, dont une qui était fausse depuis un mois et avait fait désactiver toute une fonctionnalité.

L'application est faite pour tourner sur la machine que la personne possède déjà, le plus souvent un portable sans GPU utilisable. Le travail a donc porté d'abord sur la voie CPU, et sur le fait de ne jamais faire payer à une machine un choix qui ne lui convient pas.

### Mesures principales

Mesuré sur la machine de référence (un ordinateur de bureau 6 cœurs / 12 fils ; une RTX 3090 Ti lorsqu'un GPU est impliqué). Votre machine sera différente, et c'est précisément pour cela que l'application mesure désormais la vôtre au lieu de se fier à ces chiffres.

| Changement | Effet |
|---|---|
| Moteur CPU Relaxed-SIMD | 18,6 % de temps en moins sur int8, mesuré dans le navigateur |
| Mise en pause des animations pendant une exécution GPU | le même extrait de 3 minutes est passé de 12 min 39 s à 8,5 s |
| WebGPU, une fois ce problème corrigé | environ 19 s contre environ 102 s sur un enregistrement de 6,5 minutes, soit environ 5x plus rapide que la voie CPU |
| Fenêtre de découpage de 60 secondes (au lieu de 20 s) | moins d'exécutions de l'encodeur par extrait, et moins de jointures à recoudre |
| Encodage parallèle | +4,2 % sur une machine au repos, mais 14,6 % de moins sur une machine chargée, d'où le relèvement de son seuil matériel |

### Ajouté

- **Configuration automatique : l'application mesure votre machine au lieu de supposer.** Deux graphes ONNX d'environ 5 Mo sont chronométrés sur la voie CPU et sur la voie GPU de votre propre matériel, et la plus rapide l'emporte. Cela s'exécute une fois par machine, dans des workers jetables pour ne rien coûter au pipeline réel, et ne remplace jamais un backend que vous avez choisi vous-même. Un bouton « Configurer automatiquement les performances » dans le panneau latéral permet de relancer la mesure à la demande. Sur le GPU de référence, elle lit un avantage de 3,06x à 4,64x là où l'écart réel de bout en bout est de 5,4x : elle sous-estime donc, ce qui est le bon sens de l'erreur, car la voie GPU coûte un téléchargement de 1,2 à 2,4 Go et la recommander à tort est la seule erreur coûteuse.
- **WebGPU est de nouveau disponible**, et il est désormais choisi machine par machine par la mesure, et non par un interrupteur global. Voir plus bas pourquoi il était désactivé.
- **Moteur CPU plus rapide (Relaxed-SIMD).** L'application embarque une seconde compilation WASM d'ONNX Runtime utilisant les instructions relaxed-SIMD, retenue par un micro-benchmark au démarrage lorsqu'elle est au moins 1,5x plus rapide dans votre navigateur (cette marge est calibrée pour que Firefox, où ces instructions sont bien plus lentes, n'y bascule jamais par accident). Compilée de façon reproductible depuis une chaîne d'outils figée dans Docker, avec `VITE_ORT_RELAXED_ENABLE` comme interrupteur d'arrêt pour l'hébergeur.
- **Décodeurs top-K et log-sum-exp intégrés au graphe.** Lorsque la source du modèle les fournit, l'application préfère les graphes de décodeur qui ne renvoient que les logits top-K et calculent le log-sum-exp dans le graphe, de sorte que chaque étape de décodage cesse de recopier une ligne de vocabulaire entière hors du modèle.
- **Graphes d'encodeur optimisés.** Lorsque la source fournit un encodeur pré-optimisé, il est préféré, y compris pour la version fp32 en fragments.
- **Benchmark en un clic.** Une section du panneau latéral mesure tous les backends et toutes les précisions que votre appareil peut réellement exécuter, sur un extrait fourni avec l'application, et produit un rapport anonymisé unique que vous pouvez lire, copier ou envoyer si l'instance les collecte.
- **Encodage en pool et décodage en worker composés** sur la voie CPU, pour que l'encodage et le décodage se recouvrent (activation par l'hébergeur via `VITE_WASM_DECODE_PIPELINE`).
- **Avertissement hors Chromium.** Firefox exécute les mêmes noyaux WASM environ 9x plus lentement pour des raisons extérieures à cette application : il le signale désormais une fois, de façon fermable, au lieu de simplement sembler cassé.
- **Repli lorsqu'une installation n'a pas les poids GPU.** Si la source du modèle ne fournit aucun encodeur exécutable par le GPU, l'application charge la version CPU et vous le signale, au lieu d'échouer. Cela compte parce que la mesure peut sélectionner le GPU pour un visiteur qui ne l'a jamais choisi.

### Modifié

- **La fenêtre de découpage par défaut est passée de 20 s à 60 s**, et le plafond de 25 s à 90 s, sur la base de mesures. Une fenêtre de 20 s déjà enregistrée est migrée automatiquement.
- **L'encodage parallèle exige désormais 8 cœurs logiques**, contre 4 auparavant. Son bilan honnête est un petit gain sur une machine au repos et une vraie perte sur une machine chargée : seules les machines disposant d'une marge réelle prennent le pari.
- **Les jointures sont toujours dédupliquées**, et non uniquement quand les horodatages par mot ont été demandés.
- La variante d'encodeur « pliée » (folded) s'appelle désormais « optimisée » partout.

### Corrigé

- **La lenteur de WebGPU, qui n'a jamais été le modèle.** WebGPU était désactivé depuis juillet sur un verdict de « environ 15x plus lent que le CPU », attribué aux opérateurs à dimensions dynamiques de l'encodeur. Ce diagnostic était faux. Le moteur rend la main à la boucle d'événements environ 2000 fois par exécution de l'encodeur, et Chromium ne délivre ces rappels pas plus vite que la page ne produit d'images de composition, et ce pour tout le processus. Le simple indicateur d'attente animé taxait donc chacune de ces 2000 interruptions, avec le GPU à 0 % d'utilisation. Mettre en pause les animations de la page pendant toute la durée d'une exécution GPU a supprimé la totalité de cette taxe. Déplacer l'encodeur dans un worker, essayé en premier, s'est révélé environ 3x **pire**.
- Les points d'écoute en direct sont désormais des points de suspension statiques à opacité croissante, puisqu'une animation continue est exactement ce que décrit le point précédent.
- Un script de worker qui échoue à se charger bascule désormais sur la voie in-thread au lieu de bloquer la transcription indéfiniment, et une initialisation de worker bloquée ne peut plus paralyser une exécution.
- Une base de données de réglages privée de son magasin d'objets ne casse plus le démarrage.
- L'état de reprise des téléchargements est stocké par valeur, de sorte qu'un téléchargement repris sert correctement le cache.

### Changements de comportement notables

- **Une machine capable peut désormais télécharger d'elle-même le modèle GPU.** Lorsque la mesure trouve le GPU nettement plus rapide, l'application récupère l'encodeur fp16 (environ 1,2 Go) ou, sans `shader-f16`, l'encodeur fp32 en fragments (environ 2,4 Go), au lieu de la version int8 d'environ 600 Mo. Les personnes qui autohébergent doivent continuer à servir ces fichiers, sans quoi les visiteurs obtiennent le repli CPU décrit plus haut.
- **La sortie de secours WebGPU est inversée** : `?webgpu=0` force désormais la voie CPU. `?webgpu=1` reste accepté et sans effet néfaste.
- Une fenêtre de découpage de 20 secondes déjà enregistrée est réécrite vers la valeur par défaut de 60 secondes au premier démarrage.
