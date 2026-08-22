# Journal des modifications

**[English](./CHANGELOG.md) | [Français](./CHANGELOG_fr.md)**

Changements notables de Parakeet Web. Ce fichier commence à la version 10.0.0 ; les versions antérieures ne sont consignées que dans l'historique git.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).

---

## 10.0.0 (2026-08-21)

Un seul fil conducteur traverse toute cette version : **tirer le maximum de vitesse d'un matériel ordinaire, et cesser de supposer où se trouve cette vitesse**. Presque chaque changement ci-dessous est parti d'une mesure qui contredisait une supposition, dont une qui était fausse depuis un mois et avait fait désactiver toute une fonctionnalité.

L'application est faite pour tourner sur la machine que la personne possède déjà, le plus souvent un portable sans GPU utilisable. Le travail a donc porté d'abord sur la voie CPU, et sur le fait de ne jamais faire payer à une machine un choix qui ne lui convient pas.

### Ce que cela a réellement rapporté, mesuré

Les chiffres ci-dessous proviennent d'un A/B entrelacé entre la version 9.9.0 telle que publiée et la version 10.0.0 telle que publiée, servies côte à côte, sur le même enregistrement anglais de 6,5 minutes, sur la machine de référence (un ordinateur de bureau 6 cœurs / 12 fils ; une RTX 3090 Ti lorsqu'un GPU est impliqué). L'ordre des bras tourne à chaque répétition, afin qu'une dérive de la charge de fond ne puisse pas favoriser la version qui passe en premier ; les chiffres sont des médianes, et les intervalles sont un bootstrap par percentiles sur le rapport des médianes, accompagné d'un test de rangs de Mann-Whitney. Cette machine présente une dispersion de 5 à 10 % d'une exécution à l'autre du fait de sa propre charge résidente, supérieure à plusieurs des effets ci-dessous, et c'est pourquoi les bras CPU ont été exécutés 20 fois chacun. Votre machine sera différente, et c'est précisément pour cela que l'application mesure désormais la vôtre au lieu de se fier à ces chiffres.

| Voie | 9.9.0 | 10.0.0 | Écart |
|---|---|---|---|
| GPU (WebGPU) | 1004 s | 20 s | **50x plus rapide** |
| CPU (WASM) | 104 s | 111 s | **7 % plus lent** (p=0,03, n=20 par bras) |

**Cette version est une version GPU, et elle échange environ 7 % de la vitesse de la voie CPU contre de la précision.** En 9.9.0, la voie GPU était désactivée parce qu'elle mesurait environ 10x plus lent que la voie CPU. En 10.0.0, elle est environ 5x plus rapide que la voie CPU sur la même machine, ce qui fait toute la différence entre une voie que personne ne pouvait utiliser et la plus rapide disponible.

Cette régression CPU n'est pas diffuse, et il vaut la peine d'être précis car l'explication qui vient spontanément à l'esprit est fausse. Il ne s'agit pas de l'accumulation de plusieurs changements coûtant chacun un peu. **Tout ce que la version 10.0.0 a modifié au travail CPU en dehors de la fenêtre de découpage mesure +0,5 % (IC à 95 % de 0,945 à 1,091, p=0,71), c'est-à-dire rien du tout.** L'intégralité du déficit vient du passage de la fenêtre de découpage par défaut de 20 s à 60 s : elle coûte 6,7 % sur la nouvelle version, 8,7 % sur l'ancienne et 7,9 % sur l'encodeur int8-lite. Trois bras, deux arbres compilés indépendamment, deux quantifications, chacun avec p < 0,02. L'attention du conformer est quadratique en longueur de séquence : tripler la fenêtre triple donc le travail d'attention par segment alors qu'elle ne divise le nombre de segments que par trois.

Ces 7 % ne sont toutefois pas une régression à corriger, car ce n'est pas la vitesse que la fenêtre plus longue visait. **Elle transcrit plus précisément.** Une grille sur 200 longs extraits médicaux français (2,7 h d'audio) place les segments de 60 s à +0,14 WER du décodage de chaque extrait en entier, contre +0,66 à 20 s et +1,28 à 25 s : chaque jointure coûte un peu, surtout des suppressions au raccord, donc moins de jointures donnent un meilleur résultat. Cette même fenêtre vaut par ailleurs 2,3x sur le GPU. La voie CPU paie donc environ 7 % pour à peu près un demi-point de WER, et c'est le compromis voulu et non un oubli.

Une affirmation de cette grille ne survit pas à la présente mesure : elle donnait le débit comme constant quelle que soit la taille de fenêtre. Il ne l'est pas, du moins sur cette machine, de 7 à 9 % sur trois bras. Le résultat de précision, lui, n'est pas affecté.

Deux affirmations d'une version antérieure de ces notes ont été retirées après des mesures mieux dimensionnées, et elles figurent ici parce que le retrait est précisément ce qui est utile. La voie CPU était donnée comme ne montrant « aucun écart mesurable » avec n=13 par bras, ce qui était une limite de cette mesure et non une propriété du code ; et les sorties de décodeur top-K ainsi que le graphe d'encodeur optimisé étaient crédités d'améliorations CPU « mesurant bien isolément ». Avec n=20, leur effet conjoint est indiscernable de zéro. Les deux graphes restent préférés lorsque la source du modèle les fournit, et restent utiles sur la voie GPU, mais aucun n'apporte quoi que ce soit de mesurable sur la voie CPU.

Changement par changement, lorsqu'un chiffre existe :

| Changement | Effet mesuré |
|---|---|
| Mise en pause des animations pendant une exécution GPU | 22x sur la voie GPU à elle seule ; un extrait de 3 minutes est passé de 12 min 39 s à 8,5 s |
| Fenêtre de découpage de 60 secondes (au lieu de 20 s) | environ 0,5 WER de mieux qu'à 20 s ; 2,3x sur la voie GPU ; 7 % plus lent sur la voie CPU |
| Encodage parallèle | +4,2 % sur une machine au repos, 14,6 % de moins sur une machine chargée, d'où le relèvement de son seuil matériel |
| Décodeur top-K, graphe d'encodeur optimisé | aucun effet mesurable sur la voie CPU (voir ci-dessus) |

### Ce que cela coûte

Le premier chargement du modèle sur la voie CPU est passé de 11,4 s à 13,8 s, et la mémoire maximale d'environ 10,1 Go à environ 11,1 Go. Sur la voie GPU, ces deux grandeurs n'ont été mesurées qu'avec deux exécutions par bras, où l'écart ne se distingue pas du bruit. L'application embarque également environ 6 Mo de fichiers statiques supplémentaires, dont 5 Mo pour les graphes de mesure.

Ce chargement initial plus lent est un compromis délibéré : après avoir écrit le modèle dans IndexedDB, l'application le relit désormais depuis cette base au lieu de réutiliser la copie en mémoire, ce qui coûte une lecture complète supplémentaire d'un fichier de 833 Mo mais évite toute une catégorie d'échecs de chargement dus à des blobs corrompus. Les chargements suivants passent de toute façon par le cache et restent inchangés.

### Ajouté

- **Configuration automatique : l'application mesure votre machine au lieu de supposer.** Deux graphes ONNX d'environ 5 Mo sont chronométrés sur la voie CPU et sur la voie GPU de votre propre matériel, et la plus rapide l'emporte. Cela s'exécute une fois par machine, dans des workers jetables pour ne rien coûter au pipeline réel, et ne remplace jamais un backend que vous avez choisi vous-même. Un bouton « Configurer automatiquement les performances » dans le panneau latéral permet de relancer la mesure à la demande. Sur le GPU de référence, elle lit un avantage de 3,06x à 4,64x, face à un écart réel de bout en bout d'environ 5x mesuré sur un extrait de 6,5 minutes : elle sous-estime donc, ce qui est le bon sens de l'erreur. Ce qui vous protège n'est pas sa précision mais son seuil : la voie GPU coûte un téléchargement de 1,2 à 2,4 Go, la recommander à tort est la seule erreur coûteuse, et elle ne vous y déplace donc que lorsqu'elle lit au moins 2x.
- **WebGPU est de nouveau disponible**, et il est désormais choisi machine par machine par la mesure, et non par un interrupteur global. Voir plus bas pourquoi il était désactivé.
- **Décodeurs top-K et log-sum-exp intégrés au graphe.** Lorsque la source du modèle les fournit, l'application préfère les graphes de décodeur qui ne renvoient que les logits top-K et calculent le log-sum-exp dans le graphe, de sorte que chaque étape de décodage cesse de recopier une ligne de vocabulaire entière hors du modèle.
- **Graphes d'encodeur optimisés.** Lorsque la source fournit un encodeur pré-optimisé, il est préféré, y compris pour la version fp32 en fragments.
- **Benchmark en un clic.** Une section du panneau latéral mesure tous les backends et toutes les précisions que votre appareil peut réellement exécuter, sur un extrait fourni avec l'application, et produit un rapport anonymisé unique que vous pouvez lire, copier ou envoyer si l'instance les collecte.
- **Encodage en pool et décodage en worker composés** sur la voie CPU, pour que l'encodage et le décodage se recouvrent (activation par l'hébergeur via `VITE_WASM_DECODE_PIPELINE`).
- **Avertissement hors Chromium.** Firefox exécute les mêmes noyaux WASM environ 11x plus lentement pour des raisons extérieures à cette application (mesuré ici à 1153 s contre 104 s sur Chromium pour le même extrait de 6,5 minutes) : il le signale désormais, de façon fermable, au lieu de simplement sembler cassé. À noter que l'avertissement réapparaît à chaque chargement de page et non une seule fois.
- **Repli lorsqu'une installation n'a pas les poids GPU.** Si la source du modèle ne fournit aucun encodeur exécutable par le GPU, l'application charge la version CPU et vous le signale, au lieu d'échouer. Cela compte parce que la mesure peut sélectionner le GPU pour un visiteur qui ne l'a jamais choisi.

### Modifié

- **La fenêtre de découpage par défaut est passée de 20 s à 60 s**, et le plafond de 25 s à 90 s, sur la base de mesures. Moins de jointures de raccord donnent une meilleure transcription, d'environ un demi-point de WER sur une grille de 200 extraits, et la fenêtre plus longue vaut 2,3x sur le GPU. Elle coûte environ 7 % sur la voie CPU, ce qui est le prix de cette précision. Une fenêtre de 20 s déjà enregistrée est migrée automatiquement, et le réglage reste ajustable pour qui préfère récupérer ces 7 %.
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
