<p align="center">
  <img src="./icon.svg" alt="Logo Parakeet Web" width="128" height="128" />
</p>

# Parakeet Web

**[English](./README.md) | [Français](./README_fr.md)**

> ⚠️ **PROJET EXPÉRIMENTAL EN COURS** – Réalisé avec soin mais avec l'IA. Attendez-vous à des bugs, des changements cassants et des aspérités.

**Essayez-le maintenant sur [parakeetweb.olicorne.org](https://parakeetweb.olicorne.org/) :** rien à installer, aucun compte à créer, aucune publicité, aucun pistage personnel ni intersites. Fonctionne partout où Chrome est installé, et toute la transcription se fait localement dans votre navigateur.

Réalisé par Olivier Cornelis, psychiatre et développeur / data scientist ([bio](https://olicorne.org)).

---

## Table des matières

- [Fonctionnalités](#fonctionnalités)
- [Démarrage rapide](#démarrage-rapide)
- [Mode dictée](#mode-dictée)
- [Appareils de dictée (SpeechMike)](#appareils-de-dictée-speechmike)
- [Transcription en direct](#transcription-en-direct)
- [Renforcement de phrases](#renforcement-de-phrases)
- [Microphone distant (téléphone comme micro)](#microphone-distant-téléphone-comme-micro)
- [Modèle local de secours](#modèle-local-de-secours)
- [Débogage mobile](#débogage-mobile)
- [Architecture](#architecture)
- [Licence](#licence)
- [Remerciements](#remerciements)
- [Crédits](#crédits)

---

Reconnaissance vocale dans le navigateur, fonctionnant entièrement côté client grâce au modèle [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) de NVIDIA (converti au format ONNX par [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) puis re-quantifié pour cette application sous [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx)) via WebGPU/WASM.

![](./image.png)

## Fonctionnalités

| Fonctionnalité | Détails |
|---|---|
| 🔒 **100% privé** | Fonctionne entièrement dans votre navigateur — aucun audio ne quitte jamais votre appareil |
| ⚡ **Accéléré par WebGPU** | Inférence GPU rapide avec repli automatique sur WASM pour la compatibilité |
| 🎙️ **Téléphone comme micro** | Utilisez votre téléphone comme microphone sans fil via WebRTC chiffré de bout en bout |
| ⏱️ **Transcription en direct** | Mode streaming optionnel : le texte apparaît au fur et à mesure que vous parlez, les regex de dictée étant appliquées en temps réel |
| 🎯 **Renforcement de phrases** | Oriente le décodeur vers votre propre liste de phrases (noms, jargon, noms de médicaments, acronymes), avec des poids optionnels par phrase. Fonctionne entièrement côté client |
| 🔦 **Recherche en faisceau (beam search)** | Décodage multi-hypothèses optionnel (transcription de fichier) qui permet au renforcement de phrases de récupérer des mots que le décodage glouton aurait écartés ; la largeur 1 (glouton) reste la valeur par défaut |
| 📝 **Mode dictée** | Post-traite les transcriptions avec des règles regex (vocabulaire médical français, ponctuation, unités) |
| 🕐 **Horodatage des mots** | Horodatage par mot et carte de chaleur des scores de confiance |
| 📁 **Fichier ou micro** | Transcrivez des fichiers audio téléversés ou enregistrez directement depuis votre microphone |
| 🎚️ **Contrôles de capture** | Bascules par enregistrement pour la suppression de bruit, l'annulation d'écho et le contrôle automatique du gain |
| 🌐 **Interface bilingue** | Interface disponible en anglais et en français, sélectionnée automatiquement selon la langue de votre navigateur (le modèle sous-jacent est lui-même multilingue) |
| 📦 **Quantification automatique** | La précision de l'encodeur suit automatiquement le backend : sur WebGPU, il utilise fp16 (~1,2 Go, quasi sans perte, et plus léger à servir ; sur un backend sans noyaux de calcul fp16, il est converti en fp32 à précision identique), ne basculant vers un encodeur fp32 complet (~2,4 Go) que lorsque le dépôt du modèle ne fournit pas de fichier fp16 ; sur WASM, il utilise int8 (plus léger, et le seul qui tienne dans le tas 32 bits du navigateur / la limite de récupération de blob). Le décodeur tourne en int8, ou en fp16 aux côtés d'un encodeur fp16. Les fichiers fp16 sont générés par le script `scripts/quantize-fp16.py` fourni dans le dépôt du modèle [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx) (voir aussi la [fiche du modèle fp16 de grikdotnet](https://huggingface.co/grikdotnet/parakeet-tdt-0.6b-fp16) qui documente la même conversion) |
| 🐳 **Prêt pour Docker** | Déploiement auto-hébergé en une seule commande |

> **Prévu :** au fur et à mesure de la maturation du projet, je souhaite à terme ajouter la prise en charge de [WEBCAT](https://github.com/freedomofpress/webcat/) (Web-based Code Assurance and Transparency) pour des garanties de sécurité encore plus fortes, afin que vous puissiez vérifier cryptographiquement que le code exécuté dans votre navigateur est bien celui qui a été réellement publié.

## Démarrage rapide

```bash
# 1. Copiez le fichier d'environnement d'exemple et éditez-le avec vos propres valeurs
cp docker/env.example docker/.env

# 2. Lancez la démo localement avec Docker
sudo docker compose -f docker/docker-compose.yml up
```

3. Rendez-vous ensuite sur `http://localhost:5173`

## Mode dictée

Parakeet Web inclut un **mode dictée expérimental** qui post-traite les transcriptions à l'aide de règles regex pour nettoyer la ponctuation dictée, le vocabulaire médical et les abréviations d'unités. C'est particulièrement utile pour la dictée médicale en français.

Les règles regex proviennent du [dépôt murmure-regex](https://framagit.org/interhop/murmure-regex) de l'association à but non lucratif [interhop.org](https://interhop.org/), créées à l'origine pour le logiciel [Murmure](https://github.com/Kieirra/murmure). Un unique fichier CSV combiné est téléchargé automatiquement au démarrage du conteneur. J'étudie la possibilité de contribuer à [Murmure](https://github.com/Kieirra/murmure) en amont.

Les règles sont en français et couvrent des catégories telles que la ponctuation, les abréviations d'unités, les modèles d'examen clinique, les corrections de noms de médicaments et les corrections de vocabulaire médical.

Cette fonctionnalité est très précoce et s'améliorera rapidement.

### Comment ça marche

- **Docker** : le script d'entrée télécharge l'unique fichier combiné `regex.csv` depuis le [dépôt murmure-regex](https://framagit.org/interhop/murmure-regex) à chaque démarrage du conteneur.
- **Frontend** : l'application charge les règles CSV au démarrage via un fichier manifeste et les applique comme des remplacements JavaScript `RegExp`. Après le traitement regex, chaque ligne est débarrassée des espaces de début/fin et sa première lettre est mise en majuscule. Trois modes d'affichage sont disponibles par transcription : **Brut**, **Confiance** (carte de chaleur) et **Dictée** (nettoyé par regex).
- **Source regex personnalisée** : définissez la variable d'environnement `DICTATION_REGEX_SOURCE` pour remplacer l'URL Murmure par défaut. Il peut s'agir d'une URL de dépôt compatible GitLab (par ex. `https://framagit.org/interhop/murmure-regex`) ou d'un chemin de dossier local contenant des fichiers regex CSV (par ex. `/path/to/my/regex-csvs`). Cela vous permet d'itérer sur les règles regex localement sans attendre les changements en amont.

## Appareils de dictée (SpeechMike)

Parakeet Web prend en charge les appareils de dictée physiques (Philips SpeechMike et similaires) via [GoogleChromeLabs/dictation_support](https://github.com/GoogleChromeLabs/dictation_support). Les boutons RECORD, PLAY/PAUSE et STOP de l'appareil contrôlent le cycle de vie de l'enregistrement dans l'application :

- **RECORD** : démarre un nouvel enregistrement (ignoré si un enregistrement est déjà en cours ; utilisez PLAY pour mettre en pause/reprendre à la place).
- **PLAY** : met en pause ou reprend l'enregistrement en cours.
- **STOP** : arrête l'enregistrement (ou en démarre un nouveau lorsqu'inactif).

Appairez l'appareil une fois via le bouton **Connecter l'appareil de dictée** dans les paramètres ; lors des visites suivantes, la page se reconnecte automatiquement sans clic supplémentaire.

> **Limitation du navigateur :** cette fonctionnalité utilise l'[API WebHID](https://developer.mozilla.org/en-US/docs/Web/API/WebHID_API), qui n'est actuellement disponible que dans les **navigateurs basés sur Chromium** (Chrome, Edge, Brave, Opera, Vivaldi, ...). Firefox et Safari n'implémentent pas WebHID, les boutons physiques ne peuvent donc pas piloter l'application sur ces navigateurs. Vous pouvez toujours utiliser l'appareil comme un microphone USB classique dans n'importe quel navigateur, mais vous devez démarrer et arrêter l'enregistrement avec les contrôles à l'écran. Sur les navigateurs non-Chromium, Parakeet Web tente de détecter un SpeechMike branché à partir de la liste des périphériques d'entrée audio et affiche une indication vous orientant vers un navigateur compatible.

Cette intégration a été mise en place avec [Claude Code](https://www.anthropic.com/claude-code).

## Transcription en direct

Par défaut, la transcription s'exécute une fois lorsque vous arrêtez l'enregistrement. Si vous préférez voir le texte apparaître au fur et à mesure que vous parlez, activez la **Transcription en direct** dans le panneau des paramètres. Le modèle est alors ré-exécuté toutes les quelques secondes sur une fenêtre glissante d'audio récent, et la transcription se met à jour de façon incrémentale pendant l'enregistrement. La regex de dictée (si chargée) est appliquée à tout le texte visible à chaque mise à jour, donc des corrections comme « point virgule » → « ; » se produisent aussi en direct.

Cela fonctionne à la fois pour le microphone local et pour le chemin [téléphone-comme-micro](#microphone-distant-téléphone-comme-micro) — le transcripteur en direct consomme le même tampon audio dans les deux cas.

### Comment ça marche

L'encodeur de Parakeet n'est pas en streaming (il voit toute la fenêtre d'un coup avec auto-attention), donc la précision dépend fortement de la présence de suffisamment de contexte acoustique. Le transcripteur en direct maintient une **fenêtre de contexte** glissante des *N* dernières secondes d'audio et ré-exécute le modèle dessus toutes les quelques secondes. Les mots proches du bord arrière de la fenêtre sont « en attente » (peuvent être révisés par la fenêtre suivante, à contexte plus large) et les mots passés au-delà d'une frontière de validation de 3 secondes sont figés définitivement. Résultat : chaque mot finit par être transcrit avec au moins 3 secondes de contexte droit, tout en vous laissant voir les mises à jour pendant que vous parlez.

Lorsque vous appuyez sur stop, la passe de transcription canonique sur l'audio complet s'exécute comme toujours, et son résultat remplace celui en direct — le mode direct n'affecte donc jamais la précision finale.

### Paramètres

- **Transcription en direct** (désactivée par défaut) : active ou désactive le mode streaming.
- **Fenêtre de contexte** : combien de secondes d'audio récent l'encodeur voit à chaque mise à jour.
  - **Auto** (recommandé) : commence à 15 s et s'adapte d'elle-même entre **10 s et 60 s** selon la vitesse réelle de transcription de votre machine. Les machines plus rapides obtiennent une fenêtre plus large (plus de contexte, meilleure précision) ; les machines plus lentes en obtiennent une plus petite (pour que les mises à jour suivent).
  - Ou choisissez une valeur fixe (10/15/20/30/45/60 s) si vous voulez surcharger l'adaptateur auto — par exemple, choisissez 60 s sur un ordinateur de bureau rapide pour maximiser la précision, ou 10 s sur un téléphone pour maintenir une latence faible.

La cadence (à quelle fréquence la transcription en direct se met à jour) est toujours auto-adaptée : si une passe de transcription prend plus de temps que prévu, les mises à jour ralentissent pour que la file ne grossisse jamais. Activez **Afficher plus de détails** dans les paramètres pour voir la taille de fenêtre actuelle, l'intervalle de pas et le temps de traitement par tick sous la transcription en direct.

Cette fonctionnalité a été implémentée avec [Claude Code](https://www.anthropic.com/claude-code).

## Renforcement de phrases

Les modèles vocaux entendent de façon fiable mal les mots qu'ils ont rarement vus à l'entraînement : noms de personnes, noms de lieux locaux, noms de médicaments, jargon de niche, acronymes. Le **renforcement de phrases** vous permet de donner au décodeur une courte liste de mots et de phrases à favoriser, afin qu'un audio acoustiquement ambigu se résolve vers eux plutôt que vers un sosie plus courant.

Ouvrez le panneau des paramètres et trouvez le groupe **Renforcement de phrases** :

- **Phrases à renforcer** : une phrase par ligne, avec jusqu'à trois champs optionnels séparés par des deux-points (`phrase:POIDS:MINP:AUG`). La syntaxe complète par ligne se trouve dans la référence dépliable ci-dessous ; les deux champs les plus courants sont :
  - `phrase:POIDS`, par ex. `acetaminophen:2.5`. Un poids positif pousse le décodeur *vers* la phrase ; un poids **négatif** l'en éloigne (une pénalité), par ex. `euh:-3` pour supprimer un mot de remplissage. La plage valide est de -10 à 10 (non nul) ; un poids hors plage ou nul est ignoré avec un avertissement en ligne et traité comme 1.
  - `phrase:POIDS:MINP`, par ex. `venlafaxine:5:0.1`, définit une **barrière min-p** par phrase : la phrase n'est poussée que lorsque son token est au moins `MINP` fois aussi probable que le meilleur candidat du modèle pour cette étape. Cela maintient le renforcement comme un coup de pouce au classement plutôt qu'un marteau qui pourrait halluciner une phrase que le modèle n'a jamais considérée, et contrairement à un top-k fixe, cela s'adapte à la confiance du modèle à chaque étape (serré près d'un pic confiant, plus large quand le modèle hésite). Le min-p par défaut est 0.05 (au moins 5 % aussi probable que le meilleur candidat).
- **Force de renforcement** : un multiplicateur global appliqué par-dessus le poids de chaque phrase. Va de -10 à 10 ; mettez-le à 0 pour désactiver le renforcement sans effacer votre liste. Une force négative inverse toutes les phrases d'un coup (les renforcements deviennent des pénalités).
- **Augmenter les phrases** : une bascule globale qui, lorsqu'elle est activée, décline chaque phrase en formes supplémentaires avant l'encodage (le décodeur compare des tokens sensibles à la casse, donc `venlafaxine` seul ne correspond pas à `Venlafaxine`). Elle ajoute la Casse De Titre, les MAJUSCULES, les préfixes proclitiques (si bien qu'un terme commençant par une voyelle comme `amoxicilline` renforce aussi `l'amoxicilline` / `d'amoxicilline`) et les formes sans symboles (si bien que `alpha-methyl` renforce aussi `alpha methyl`). Remplacez-la par phrase avec le champ `AUG` ci-dessous.

Votre liste de phrases et la force sont enregistrées localement (IndexedDB) et survivent aux rechargements. Comme tout le reste de cette application, le renforcement fonctionne **100% dans votre navigateur** : rien de vos phrases n'est envoyé où que ce soit.

**Listes fournies par l'opérateur (optionnel, auto-hébergé) :** définissez la variable d'environnement `BOOST_PHRASES_SOURCE` sur un dossier local de fichiers `.txt` (une phrase par ligne, même syntaxe par ligne que la boîte de saisie) ou sur une URL https pointant vers un unique fichier `.txt`. Lorsqu'au moins une liste est trouvée, un sélecteur apparaît au-dessus de la boîte pour que les utilisateurs puissent choisir quelle liste charger ; en choisir une remplit la boîte avec le contenu de ce fichier. Le sélecteur inclut toujours une entrée **Personnalisé** pour saisir vos propres phrases, et ce texte personnalisé est enregistré entre les sessions indépendamment des fichiers chargés. Une liste servie peut être pré-réglée en portant ses propres valeurs par défaut par phrase sur une ligne `*:POIDS:MINP:AUG` (voir la référence dépliable ci-dessous), et les très grandes listes peuvent être précompilées en fichiers `.pwc` pour que le conteneur évite de les ré-encoder à chaque démarrage (un gain au démarrage du serveur, pas côté visiteur ; voir la référence dépliable ci-dessous). Lorsque la variable n'est pas définie, aucun sélecteur n'est affiché et la boîte fonctionne exactement comme décrit ci-dessus (saisie manuelle uniquement). Le `docker-compose.yml` fourni embarque une liste curée prête à l'emploi : il monte (bind-mount) le dossier `phrase_boosting/` du dépôt (actuellement une liste `french_medical`) à `/boost-defaults` et fixe `BOOST_PHRASES_SOURCE` par défaut sur ce chemin, si bien que le sélecteur est rempli sans configuration supplémentaire. Mettez `BOOST_PHRASES_SOURCE=` (vide) dans votre `.env` pour ne servir aucune liste.

**Pré-sélectionner une liste par défaut :** définissez `VITE_PHRASE_BOOST_DEFAULT` sur l'un des noms de liste servis (un nom simple comme `medical` ou `medical.txt`) pour qu'elle soit pré-sélectionnée pour les nouveaux visiteurs. Le conteneur refuse de démarrer si le nom ne correspond à aucune liste qu'il sert, de sorte qu'une faute de frappe de l'opérateur ne peut jamais retomber silencieusement sur la saisie manuelle. Vous pouvez aussi pré-sélectionner une liste lien par lien avec le paramètre d'URL `?phrase_boost=<nom>` (ex. `https://votre-hote/?phrase_boost=medical`), pratique pour partager un lien prêt à l'emploi. Ni la valeur par défaut d'environnement ni le paramètre d'URL ne remplacent la sélection enregistrée d'un utilisateur de retour ; ils ne fixent le défaut que lorsque le visiteur n'a pas encore de choix enregistré. Le `docker-compose.yml` fourni fixe cette valeur par défaut sur `french_medical` (la liste embarquée) ; mettez `VITE_PHRASE_BOOST_DEFAULT=` (vide) dans votre `.env` pour ne rien pré-sélectionner.

<details>
<summary><strong>Syntaxe complète par ligne, fonctionnement du renforcement et listes précompilées</strong></summary>

#### Syntaxe par ligne

Chaque ligne est `phrase` suivie de jusqu'à trois champs optionnels séparés par des deux-points, `phrase:POIDS:MINP:AUG` :

- `POIDS` (par défaut 1) : le poids de renforcement, de -10 à 10 (non nul). Positif pousse *vers* la phrase, négatif *à l'écart* (une pénalité). Hors plage ou nul est ignoré avec un avertissement en ligne et traité comme 1.
- `MINP` (par défaut 0.05) : la barrière min-p par phrase, un nombre dans (0, 1] ; la phrase n'est poussée que lorsque son token est au moins `MINP` fois aussi probable que le meilleur candidat du modèle pour cette étape. Contrairement à un rang top-k fixe, cela s'adapte à la confiance du modèle à chaque étape.
- `AUG` : augmente cette seule phrase en formes supplémentaires, en remplaçant la bascule globale **Augmenter les phrases**. N'importe quel mélange de `f` (Casse De Titre), `a` (MAJUSCULES), `p` (préfixes proclitiques, par ex. `l'`/`d'` collés à un terme commençant par une voyelle) et `h` (suppression des symboles/séparateurs, si bien que `alpha-methyl` renforce aussi `alpha methyl` ; couvre `, . ' " - _ ? !` et consorts). Deux raccourcis : `s` n'en force aucune (telle quelle) et `i` les active toutes. Omettez pour utiliser la valeur par défaut globale.

Laissez un champ antérieur vide pour conserver sa valeur par défaut tout en définissant un champ ultérieur, par ex. `venlafaxine::0.1` conserve le poids 1 mais fixe le min-p à 0.1, et `amoxicilline:5::faph` définit les trois.

Une liste peut arriver pré-réglée grâce à une ligne de valeurs par défaut `*:POIDS:MINP:AUG` : elle fixe le poids, le min-p et l'augmentation par défaut pour chaque ligne qui la suit (jusqu'à ce qu'une autre ligne `*` les change), avec exactement les mêmes champs qu'une phrase. Ainsi `*:2` met le reste de la liste au poids 2, `*:::faph` augmente le reste, et `*:1.5:0.1:fhp` définit les trois ; chaque champ vide laisse cette valeur par défaut inchangée, et un champ par phrase l'emporte toujours sur la valeur par défaut `*`. Un poids `*` est une valeur *par défaut* par phrase, pas le multiplicateur global : le curseur de force multiplie encore l'ensemble (vos phrases saisies et la liste) par-dessus, si bien qu'un `*:2` de la liste avec un curseur à 1,5 donne un poids effectif de 3. Une liste peut aussi remplacer les préfixes proclitiques utilisés par l'augmentation `p` avec une ligne `#!prefixes a' b' ...` (séparés par des espaces) ; le défaut est l'ensemble d'élision française (`l'`, `d'`, `L'`, `D'`). Un préfixe se terminant par une apostrophe ne s'attache que devant une voyelle (donc `l'amoxicilline` mais jamais `l'beta`) ; tout autre préfixe (par ex. l'arabe `al-`) s'attache sans condition.

#### Comment ça marche

Il s'agit d'un portage navigateur du *concept* derrière le [Phrase-Boosting accéléré par GPU](https://github.com/NVIDIA-NeMo/NeMo/pull/14277) de NVIDIA NeMo (voir aussi le ticket [#14772](https://github.com/NVIDIA-NeMo/NeMo/issues/14772)). Chaque phrase est tokenisée avec une réimplémentation fidèle du tokeniseur BPE du modèle et insérée dans un **trie de renforcement** au niveau des tokens. Pendant le décodage, avant que chaque token ne soit choisi, le trie ajoute une récompense additive (fusion superficielle) dans l'**espace des logits** aux tokens qui commenceraient ou continueraient l'une de vos phrases, les correspondances plus profondes étant un peu plus récompensées pour encourager la finition d'une phrase une fois commencée. Ajouter à un logit est le coup de pouce principiel dans le domaine logarithmique : cela multiplie la probabilité de ce token avant que le softmax ne renormalise, plutôt que de mettre grossièrement à l'échelle la probabilité finale. Une **barrière min-p** garde la récompense honnête : un token n'est renforcé que lorsque sa probabilité atteint au moins une fraction fixe de celle du meilleur candidat du modèle pour cette étape (par défaut 0.05, soit 5 %, configurable par phrase), de sorte qu'un poids fort pousse le classement sans forcer un mot que le modèle n'a jamais considéré. C'est la règle min-p de l'échantillonnage des LLM : elle s'adapte à la distribution de chaque étape (serrée près d'un pic confiant, plus large quand le modèle hésite), là où un rang top-k fixe admettrait du bruit sur les étapes confiantes et raterait un terme rare mais plausible sur les étapes incertaines. Un poids négatif applique la même récompense avec le signe opposé, pénalisant la phrase à la place.

Par défaut, cette application décode de façon **gloutonne** (un meilleur token par étape), donc le renforcement fait au mieux : il biaise chaque étape vers vos phrases, mais il ne peut pas récupérer une phrase que le décodeur glouton a déjà écartée à une étape antérieure. Augmenter le paramètre **Largeur de faisceau (Beam Width)** (transcription de fichier uniquement ; voir ci-dessous) laisse le décodeur conserver plusieurs hypothèses concurrentes, de sorte qu'une phrase renforcée peut survivre dans un faisceau de rang inférieur jusqu'à ce que l'audio la confirme, ce qui est exactement le cas que le glouton ne peut pas récupérer. La recherche en faisceau coûte environ Nx le temps de décodage pour une largeur N, donc la largeur 1 (glouton) reste la valeur par défaut. La force de renforcement aide aussi, mais de très grandes valeurs peuvent déformer un texte autrement correct, alors commencez petit et augmentez seulement au besoin. Le texte latin accentué et les ligatures (par ex. `isotrétinoïne`, `sœur`) sont entièrement pris en charge. Les écritures pour lesquelles le tokeniseur n'a aucun token (par ex. chinois/japonais/coréen) s'effondrent en un seul token inconnu et ne peuvent pas être renforcées ; de telles phrases sont automatiquement ignorées et listées dans un avertissement en ligne plutôt que silencieusement écartées. Il s'agit d'une limitation du tokeniseur, pas d'un bug.

#### Listes précompilées (`.pwc`, auto-hébergé uniquement)

Lorsque `LOCAL_MODEL_PATH` est défini, le conteneur encode chaque liste fournie par l'opérateur en identifiants de tokens au démarrage et sert le résultat (un fichier `.json` voisin) afin que les navigateurs des visiteurs sautent ce travail. Les visiteurs sont déjà rapides dans les deux cas ; ce qui n'est pas gratuit, c'est cet encodage au démarrage lui-même, qui se relance à **chaque** démarrage du conteneur et est lent pour une très grande liste (10k à 100k phrases). La précompilation épargne au **serveur** ce travail répété au démarrage (elle ne change pas la vitesse côté visiteur). Compilez la liste une fois :

```bash
node scripts/compile-boost.mjs my-list.txt --model-dir /path/to/model
```

(utilisez le même dossier de modèle que celui monté à `LOCAL_MODEL_PATH`) et déposez le fichier `my-list.pwc` résultant à côté de `my-list.txt` dans votre dossier `BOOST_PHRASES_SOURCE`. Le `.pwc` est un fichier compressé en gzip (il n'est jamais relu que par le conteneur, jamais récupéré par un navigateur, il est donc livré plus petit). Le conteneur réutilise alors les identifiants de tokens du `.pwc` au démarrage au lieu de ré-encoder, réduisant le temps de démarrage du conteneur, tant que sa signature de vocabulaire correspond au modèle. Si le modèle (et donc le vocabulaire) diffère, le `.pwc` périmé est silencieusement ignoré et le `.txt` est ré-encodé, donc un `.pwc` non concordant n'est jamais erroné, seulement sauté. La réutilisation de `.pwc` ne concerne que les dossiers locaux (la forme à URL unique ré-encode toujours).

</details>

Cette fonctionnalité a été implémentée avec [Claude Code](https://www.anthropic.com/claude-code).

## Microphone distant (téléphone comme micro)

**Pas de microphone ? Pas de problème !** Utilisez votre téléphone comme micro sans fil via WebRTC. L'audio est chiffré de bout en bout (ECDH P-256 + AES-GCM-256) — le serveur ne relaie que des données chiffrées et ne voit jamais l'audio en clair.

1. Cliquez sur le bouton **Micro téléphone** dans l'application
2. Un QR code apparaît — scannez-le avec votre téléphone
3. Accordez l'autorisation du microphone sur le téléphone
4. **Vérifiez que le code court** qui apparaît sur les deux écrans correspond — lisez-le à voix haute ou comparez visuellement. Si les codes diffèrent, cliquez sur **Les codes diffèrent – abandonner** sur l'un ou l'autre appareil. Cette étape protège contre un serveur de signalisation malveillant qui pourrait sinon échanger les clés de chiffrement pour intercepter (MITM) le canal supposé chiffré de bout en bout. Le bouton Confirmer est désactivé pendant 3 secondes (avec un compte à rebours visible) afin qu'une pression réflexe sur Entrée/Espace ne puisse pas auto-accepter un code falsifié sans que vous l'ayez réellement lu.
5. Parlez — l'audio chiffré est diffusé vers l'ordinateur en temps réel
6. Cliquez sur **Stop** sur l'un ou l'autre appareil — l'audio est transcrit normalement

### Envoyer un fichier audio enregistré depuis le téléphone

Une fois l'appairage effectué, la page du téléphone propose aussi **📁 Envoyer
un fichier audio**. Choisissez n'importe quel fichier audio sur le téléphone
(mp3, m4a, wav, ...) : il est décodé en PCM **sur le téléphone**, puis diffusé
par le même tunnel chiffré de bout en bout que le micro en direct. L'ordinateur
le découpe, le rééchantillonne et le transcrit exactement comme un
enregistrement, y compris le découpage reprenable des longs audios — il n'y a
pas de chemin d'envoi distinct et le relais ne voit toujours que du chiffré.
Une barre de progression affiche le transfert (plus rapide que le temps réel),
que vous pouvez annuler. Les fichiers très longs sont tronqués sur le téléphone
avec un avertissement (la limite de session correspond à environ 60 minutes
d'audio à 16 kHz). Le téléphone ne rééchantillonne jamais : il envoie le PCM
décodé et c'est l'ordinateur qui le sous-échantillonne, exactement comme un
micro de téléphone en direct, ce qui garde le décodage robuste sur tous les
navigateurs, y compris iOS Safari. Pratique quand le fichier se trouve sur
votre téléphone mais que vous voulez le transcrire sur l'ordinateur. Réalisé
avec l'aide de Claude Code.

### Se reconnecter après une coupure

Les connexions du téléphone se coupent (l'écran se verrouille, vous changez
d'application, le Wi-Fi vacille). Dans ce cas, l'ordinateur **garde le même QR
code à l'écran et attend** le retour du téléphone, au lieu de vous obliger à
tout recommencer. Deux niveaux de récupération couvrent ce scénario :

- **Reconnexion automatique.** Le téléphone mémorise l'appairage et rejoint
  silencieusement la même salle avec un court délai exponentiel. Une coupure
  brève se rétablit généralement toute seule, sans aucune action.
- **Re-scan par la caméra, dans la page.** Si la reconnexion automatique
  n'aboutit pas (trop d'échecs, ou la page du téléphone a été rechargée et a
  perdu le lien), touchez **📷 Scanner le QR code** sur le téléphone. La caméra
  arrière s'ouvre directement dans la page et vous scannez le QR toujours
  affiché sur l'ordinateur pour vous ré-appairer — sans quitter la page ni
  ouvrir une application de scan séparée. (Un ré-appairage relance toujours la
  vérification du code court, la garantie de bout en bout reste donc
  inchangée.)

Si vous préférez un appairage entièrement neuf, cliquez sur **Générer un
nouveau QR** sur l'ordinateur. Les salles vivent environ 10 minutes, après quoi
il vous faudra un nouveau QR. Réalisé avec l'aide de Claude Code.

### Prérequis

- **Réseau local uniquement** : fonctionne d'emblée sans configuration supplémentaire (STUN seul / P2P direct).
- **Par Internet** : nécessite un relais TURN [coturn](https://github.com/coturn/coturn). Un service coturn commenté est inclus dans `docker/docker-compose.yml` — décommentez-le et définissez `TURN_SERVER`, `TURN_SECRET` et `TURN_EXTERNAL_IP` dans `docker/.env`. Si vous faites déjà tourner coturn (par ex. pour [WebSend](https://github.com/nicMusic/websend) ou Nextcloud Talk), pointez vers lui et réutilisez le même `TURN_SECRET`.
- **Réseaux restrictifs (en dernier recours)** : lorsque WebRTC direct et TURN/TURNS sont tous deux bloqués (certains proxys d'entreprise suppriment l'UDP et la mise à niveau TURNS CONNECT), le sidecar de signalisation peut transférer lui-même les trames audio chiffrées, par WebSocket (préféré) ou HTTP long-poll. Après l'échange SDP, le client fait courir en parallèle WebRTC et le relais pendant ~10 s : WebRTC l'emporte s'il passe, sinon le relais prend le relais et la connexion pair-à-pair est démontée. L'audio reste chiffré de bout en bout en AES-256-GCM, donc le relais ne voit jamais que du texte chiffré (c'est purement un repli de transport). Activé par défaut ; basculez avec `RELAY_ENABLE` (serveur) et `VITE_RELAY_ENABLE` (client).

Voir `docker/env.example` pour toutes les options de configuration.


## Modèle local de secours

Si HuggingFace est bloqué ou injoignable dans votre environnement, vous pouvez
servir les poids du modèle directement depuis le conteneur. Choisissez n'importe quel
dossier hôte, remplissez-le avec les fichiers ONNX, montez-le par liaison (bind-mount)
dans le conteneur, et définissez `LOCAL_MODEL_PATH` sur le chemin correspondant
dans le conteneur :

```bash
# 1. Remplissez n'importe quel dossier hôte avec les fichiers ONNX (disposition à plat) :
hf download Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx \
    --local-dir /host/path/to/onnx-files
```

```yaml
# 2. Dans docker/docker-compose.yml, ajoutez un volume :
volumes:
  - /host/path/to/onnx-files:/models:ro
```

```bash
# 3. Dans docker/.env, définissez :
LOCAL_MODEL_PATH=/models
```

Caddy sert ce qui se trouve à `LOCAL_MODEL_PATH` sous `/models/`. Le
conteneur plante au démarrage si `vocab.txt` est manquant, de sorte que
les mauvaises configurations sont détectées tôt.

Utilisez `VITE_MODEL_SOURCE` pour choisir d'où l'interface récupère les poids :

- `hf` (par défaut) : HuggingFace uniquement.
- `local` : `/models/` servi par l'instance uniquement, HuggingFace n'est jamais contacté.
- `both` : HuggingFace d'abord, repli silencieux sur `/models/` si HF est
  injoignable.

Lorsque `LOCAL_MODEL_PATH` est défini et que `VITE_MODEL_SOURCE` est laissé non défini, il
est automatiquement promu en `both`.

Le conteneur s'exécute sous l'UID 1000. Si vos fichiers finissent par être illisibles pour l'UID
1000, exécutez `chmod -R a+rX /host/path/to/onnx-files` (ou
`chown -R 1000:1000 /host/path/to/onnx-files`).

Construit avec [Claude Code](https://claude.com/claude-code).

## Débogage mobile

Ajoutez `?debug=1` à n'importe quelle URL pour charger les outils de développement [eruda](https://github.com/liriliri/eruda)
intégrés à la page — utiles pour inspecter les journaux de la console et les requêtes réseau sur un téléphone
où vous ne pouvez pas ouvrir les devtools de bureau. Eruda est vendorisé localement (servi
depuis la même origine avec SRI), donc rien n'est récupéré depuis un CDN à l'exécution.

Exemples :

- Application principale : `https://votre-hote/?debug=1`
- Page micro distant : `https://votre-hote/remote-mic.html?debug=1#ROOMID:SECRET`
  (les infos de salle sont dans le fragment de hash, donc `?debug=1` va avant le `#`)

Sans `?debug=1`, aucune surface de devtools n'est livrée à l'utilisateur.

## Architecture

Pour une carte fichier par fichier de la base de code (le moteur d'inférence, l'interface,
le serveur de signalisation, l'empaquetage Docker et la suite de tests) voir
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Licence

AGPLv3 – Voir le fichier LICENSE

## Remerciements

- **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – Projet original dont celui-ci est forké
- **[nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)** – Le modèle ASR sous-jacent par NVIDIA
- **[istupakov/parakeet-tdt-0.6b-v3-onnx](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)** – Conversion ONNX du modèle
  - Cela a été essentiel pour me permettre de réaliser ma propre quantization améliorée, disponible sur [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx)
- **[istupakov/onnx-asr](https://github.com/istupakov/onnx-asr)** – Implémentation de référence en Python
- **ONNX Runtime Web** – Rend l'inférence dans le navigateur possible

## Crédits

Ce fork est basé sur **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – tout le gros du travail et le crédit de l'implémentation originale lui reviennent. Cela n'existerait pas sans leur excellent travail.
