# Journal des modifications

**[English](./CHANGELOG.md) | [Français](./CHANGELOG_fr.md)**

Changements notables de Parakeet Web. Ce fichier commence à la version 10.0.0 ; les versions antérieures ne sont consignées que dans l'historique git.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).

---

## Non publié

### L'application se télécharge environ six fois plus vite

Chaque visiteur télécharge le bundle de l'application avant toute chose, et 130 de ses 138 Mo sont du WebAssembly : les moteurs ONNX Runtime, ffmpeg, et le moteur de diarisation. Caddy recompressait ces octets à chaque requête. Ils sont désormais compressés une seule fois, à la construction de l'image, puis servis tels quels.

Mesuré sur le bundle livré : le moteur ONNX Runtime WebGPU passe de 26 Mo à 3,5 Mo, ffmpeg de 31 Mo à 6,9 Mo, le moteur de diarisation de 17 Mo à 2,5 Mo. Le serveur cesse aussi complètement d'y consacrer du CPU.

Rien ne change pour l'application : le navigateur décode la réponse avant qu'elle ne lui parvienne, donc les octets qu'elle reçoit, et les empreintes d'intégrité qu'elle vérifie, sont exactement les mêmes. Un navigateur qui n'accepte pas brotli retombe sur le comportement précédent.

Le seul coût visible est côté mainteneur : `docker build` prend environ deux minutes et demie de plus, ce qui est précisément l'intérêt de le faire là plutôt qu'à chaque requête.

### Les poids servis en local peuvent désormais l'être compressés

Une instance qui héberge elle-même les poids peut les compresser une fois pour toutes et laisser Caddy les servir avec `Content-Encoding: zstd`. Sur l'encodeur int8 livré, cela fait passer le fichier de 881 878 510 octets à 642 839 559 (27 % de moins à télécharger, les deux mesurés), et le navigateur le décompresse nativement en 3 secondes environ : toute connexion plus lente que ~200 Mo/s y gagne.

Ce n'était pas déjà le cas par hasard : les poids sont servis en `application/octet-stream`, un type que la directive `encode` de Caddy ignore délibérément. Compresser à la volée aurait coûté 6 à 11 secondes de CPU serveur à chaque téléchargement de chaque visiteur ; les octets sont donc préparés une seule fois, par `scripts/precompress.mjs`.

À retenir pour ceux qui hébergent eux-mêmes :

- Lancez `node scripts/precompress.mjs --models <dossier-modele>` après avoir rempli (ou remplacé) le dossier de modèles. Le script est idempotent et ne fait jamais échouer un déploiement. Il utilise le binaire `zstd` si l'hôte en a un, sinon le zstd intégré à Node.
- Ou définissez `PRECOMPRESS_MODELS=1` et laissez le conteneur les préparer au démarrage. Cela nécessite que le volume de modèles soit monté en écriture (retirez son `:ro`) et prend 30 à 90 secondes au premier démarrage suivant un changement de modèle ; les démarrages suivants les trouvent à jour et ne font rien.
- Sans fichier `.zst`, ou pour un navigateur qui n'accepte pas zstd, Caddy sert le fichier brut exactement comme avant. Rien d'autre n'est à changer.
- Un fichier `.zst` plus ancien que sa source serait servi à la place du vrai fichier : le script supprime donc ceux qu'il ne peut pas régénérer, et le conteneur avertit au démarrage s'il en trouve un périmé.
- Les téléchargements qui reprennent en cours de route ne sont pas affectés : les navigateurs demandent les plages d'octets sans compression.

Cela ne concerne que les poids servis en local. Ceux téléchargés depuis HuggingFace sont servis par HuggingFace, sans compression, et rien ici n'y change quoi que ce soit.

### Une seule version par précision : les graphes optimisés sont désormais les seuls graphes

Le dépôt du modèle fournissait un fichier ONNX d'origine à côté d'une variante optimisée du même fichier, sous un nom plus long, et l'application interrogeait ces noms plus longs à chaque chargement. C'est terminé : le travail sur les graphes se trouve désormais à l'intérieur des fichiers canoniques `encoder-model*.onnx` et `decoder_joint-model*.onnx`, et il n'y a plus rien à départager.

Concrètement, voici ce que contiennent maintenant ces fichiers canoniques :

- **Les deux encodeurs ont un graphe optimisé.** Leur tuyauterie de calcul de formes à l'exécution est pré-évaluée hors ligne, ce qui réécrit la plomberie autour des calculs, pas les calculs eux-mêmes : l'int8 passe de 3547 à 2732 nœuds, le fp32 de 4491 à 2041. Les sorties sont vérifiées identiques au bit près à celles de la version non optimisée (tolérance stricte de 0,0 sur plusieurs longueurs de séquence), les transcriptions ne bougent donc pas. Sur le temps total, la réponse honnête est que la mesure n'a pas tranché : l'A/B en fp32 donne 4,7 % en faveur de la version optimisée, avec un intervalle de confiance qui englobe encore « aucune différence ».
- **Les deux décodeurs embarquent des sorties supplémentaires dans le graphe**, qu'une étape de décodage peut lire au lieu de refaire le même calcul en JavaScript : les log-partitions dont la recherche en faisceau a besoin, et les quelques plus forts logits de jetons dont la voie gloutonne a besoin, au lieu de relire depuis ONNX Runtime une ligne entière de 8193 flottants à chaque étape. Mesuré sur le backend GPU, le décodage est environ 5 % plus rapide avec elles ; le temps total, lui, ne bouge pas, parce que ce n'est pas le décodage qui domine là-bas.

Ce que cela change pour vous :

- Tout le monde bénéficie des graphes optimisés, et non plus seulement les visiteurs dont le miroir servait les fichiers supplémentaires.
- Face à un miroir servi localement, six requêtes HEAD de moins avant chaque chargement du modèle, ainsi qu'un balayage redondant à la recherche d'un second jeu de fragments fp32 : l'application ne part plus en quête de noms de fichiers qui n'existent plus.
- Rien à sélectionner et rien à configurer : il y a un fichier par précision.
- Les personnes qui autohébergent doivent recopier les noms canoniques et peuvent supprimer de leur miroir tout fichier `.optimized`, `.lse` ou `.topk`. L'application les ignore désormais.

Un miroir plus ancien reste parfaitement utilisable, y compris le dépôt amont `istupakov` : ses décodeurs ne déclarent simplement pas les sorties supplémentaires, le moteur s'en aperçoit au chargement et continue de calculer ces valeurs en JavaScript, exactement comme avant.

### Deux versions de l'encodeur retirées : `int8 lite` et `fp16`

Le dépôt du modèle fournissait quatre précisions d'encodeur. Deux d'entre elles disparaissent, du dépôt du modèle comme de l'application, ainsi que le code qui les sélectionnait.

**`int8 lite`** (environ 757 Mo contre 841 Mo pour la version par défaut) gardait davantage de couches en fp32 pour récupérer un peu de la précision sacrifiée par la quantification int8 agressive. Mesurée sur les 25 langues du jeu de validation FLEURS, elle ressort à 14,82 % de WER contre 14,27 % pour la version par défaut, et sur le jeu de huit discours en audio long à 9,9 % contre 8,6 %. Elle était donc légèrement moins bonne dans les deux cas, pour 84 Mo de téléchargement en moins. Rien ne plaidait pour elle, et chaque précision supplémentaire dans le sélecteur est une combinaison de plus à tester et une chose de plus à expliquer.

**`fp16`** (environ 1,2 Go) était la précision par défaut sur WebGPU. Elle n'a jamais pu être éprouvée de bout en bout ici : ses noyaux WGSL exigent que l'adaptateur WebGPU expose `shader-f16`, ce que le GPU sur lequel ce projet est développé ne fait pas, quoi qu'en dise le pilote. ONNX Runtime construisait la session sans broncher, puis renvoyait une transcription vide. La seule chose mesurable, sa précision sous onnxruntime natif avec calcul en fp16, était bonne, mais « bon sur une voie que l'on ne peut pas exécuter » n'est pas une précision publiable, et elle se trouvait devant chaque visiteur que la mesure de performance envoyait sur le GPU.

Ce que cela change pour vous :

- Le sélecteur de précision de l'encodeur propose désormais **int8** et **fp32**, rien d'autre.
- Sur le backend WebGPU, l'encodeur est désormais toujours en **fp32** (environ 2,4 Go, chargé en fragments). Ce n'est pas une régression par rapport à ce qui tournait réellement : c'est ce vers quoi un GPU sans `shader-f16` se rabattait déjà.
- Si vous aviez sélectionné `int8 lite` ou `fp16`, vous basculez vers la précision fonctionnelle de votre backend au prochain chargement.
- Les personnes qui autohébergent peuvent supprimer `encoder-model.int8.lite.onnx`, `encoder-model.fp16.onnx` et `decoder_joint-model.fp16.onnx` de leur miroir. **Les fragments fp32 deviennent obligatoires pour toute installation qui souhaite servir des visiteurs WebGPU**, puisque fp16 n'est plus là pour compenser un miroir qui en manque. Un miroir qui ne sert ni l'un ni l'autre se dégrade toujours proprement : ces visiteurs basculent sur la voie CPU avec un avertissement, comme auparavant.

Le script de génération fp16 est conservé dans le dépôt du modèle, de sorte que la version puisse être régénérée si une machine dotée de `shader-f16` la rend un jour testable.

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
