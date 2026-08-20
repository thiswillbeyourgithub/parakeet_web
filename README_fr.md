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
- [Choisir entre CPU et GPU](#choisir-entre-cpu-et-gpu)
- [Configuration automatique : mesurer plutôt que supposer](#configuration-automatique--mesurer-plutôt-que-supposer)
- [Moteur CPU plus rapide (Relaxed-SIMD)](#moteur-cpu-plus-rapide-relaxed-simd)
- [Mode dictée](#mode-dictée)
- [Identification des locuteurs](#identification-des-locuteurs)
- [Appareils de dictée (SpeechMike)](#appareils-de-dictée-speechmike)
- [Transcription en direct](#transcription-en-direct)
- [Renforcement de phrases](#renforcement-de-phrases)
- [Microphone distant (téléphone comme micro)](#microphone-distant-téléphone-comme-micro)
- [Modèle local de secours](#modèle-local-de-secours)
- [Serveur d'API compatible OpenAI](#serveur-dapi-compatible-openai)
- [Banc d'essai](#banc-dessai)
- [Réinitialiser l'application](#réinitialiser-lapplication)
- [Débogage mobile](#débogage-mobile)
- [Architecture](#architecture)
- [Licence](#licence)
- [Remerciements](#remerciements)
- [Crédits](#crédits)

---

Reconnaissance vocale dans le navigateur, fonctionnant entièrement côté client grâce au modèle [Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) de NVIDIA (converti au format ONNX par [istupakov](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) puis re-quantizé pour cette application sous [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx)) sur le backend WASM (CPU).

![](./image.png)

## Fonctionnalités

| Fonctionnalité | Détails |
|---|---|
| 🔒 **100% privé** | Fonctionne entièrement dans votre navigateur — aucun audio ne quitte jamais votre appareil |
| ⚡ **Fonctionne partout (WASM int8)** | La transcription s'exécute sur le backend WASM (CPU) avec un encodeur int8 SmoothQuant, donc elle marche dans tout navigateur moderne sans GPU, confortablement plus vite que le temps réel sur une machine courante. Si votre machine a un GPU, l'application mesure les deux voies dessus et ne bascule vers WebGPU que si c'est nettement plus rapide ([Choisir entre CPU et GPU](#choisir-entre-cpu-et-gpu)) |
| 🧵 **Encodage parallèle** | Sur les enregistrements longs, les segments audio sont encodés en parallèle dans des workers en arrière-plan pendant que le fil principal décode, ce qui met à profit les cœurs inutilisés. Activé par défaut sur les machines capables (8 cœurs et plus, 8 Go de RAM et plus ; cela consomme plus de mémoire car chaque worker garde sa propre copie de l'encodeur) et désactivable dans les réglages. Le gain dépend du nombre de cœurs réellement libres : sur une machine chargée, répartir le budget de threads entre plusieurs workers peut finir plus lent que le chemin simple, donc testez les deux sur vos fichiers longs si les derniers pourcents comptent |
| 🎙️ **Téléphone comme micro** | Utilisez votre téléphone comme microphone sans fil via WebRTC chiffré de bout en bout |
| ⏱️ **Transcription en direct** | Mode streaming optionnel : le texte apparaît au fur et à mesure que vous parlez, les regex de dictée étant appliquées en temps réel |
| 🎯 **Renforcement de phrases** | Oriente le décodeur vers votre propre liste de phrases (noms, jargon, noms de médicaments, acronymes), avec des poids optionnels par phrase. Fonctionne entièrement côté client |
| 🔦 **Recherche en faisceau (beam search)** | Décodage multi-hypothèses optionnel (transcription de fichier) qui permet au renforcement de phrases de récupérer des mots que le décodage glouton aurait écartés ; la valeur par défaut s'adapte à votre appareil (glouton sur téléphone, jusqu'à une largeur de 5 sur ordinateur de bureau) |
| 📝 **Mode dictée** | Post-traite les transcriptions avec des règles regex (vocabulaire médical français, ponctuation, unités) |
| 🗣️ **Identification des locuteurs** | Vue optionnelle « qui parle quand » : regroupe la transcription en tours `Premier :`/`Deuxième :`/... colorés, entièrement côté client via [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (dans un worker en arrière-plan, donc sans jamais figer l'interface). Le nombre de locuteurs est détecté automatiquement ; renommez un locuteur avec l'étiquette d'un autre pour les fusionner |
| 🕐 **Horodatage des mots** | Horodatage par mot |
| 📁 **Fichier ou micro** | Transcrivez des fichiers audio téléversés ou enregistrez directement depuis votre microphone. Les fichiers téléversés sont décodés en PCM par un **ffmpeg.wasm** intégré localement (chargé à la demande au premier téléversement), afin que le navigateur reproduise à l'octet près le décodage de l'outil en ligne de commande, y compris le rognage du délai/amorçage d'encodeur AAC que le décodeur natif du navigateur ignore (ce qui faisait autrement mal entendre p. ex. « Venlafaxine »). Repli sur le décodeur Web Audio si ffmpeg ne peut pas se charger |
| 🎚️ **Contrôles de capture** | Bascules par enregistrement pour la suppression de bruit et le contrôle automatique du gain |
| 🌐 **Interface bilingue** | Interface disponible en anglais et en français, sélectionnée automatiquement selon la langue de votre navigateur (le modèle sous-jacent est lui-même multilingue) |
| 📦 **Encodeur int8 SmoothQuant** | L'encodeur tourne en int8 SmoothQuant par défaut, recalibré pour que sa précision suive celle de fp32 même sur de l'audio long (contrairement à une conversion int8 standard qui se dégrade fortement au-delà d'environ 30 s). Depuis le sélecteur de précision de l'encodeur, vous pouvez opter pour un encodeur `int8 lite` plus léger (~757 Mo contre ~841 Mo par défaut : il garde davantage de couches en fp32), ou pour l'encodeur **fp32 fragmenté** complet (~2,4 Go, environ 2x plus lent, découpé en morceaux de moins de 2 Go par `scripts/shard-fp32.py` pour qu'il tienne dans le navigateur) pour une qualité maximale ; les précisions optionnelles s'arrêtent avec un message clair plutôt qu'une rétrogradation silencieuse lorsque le dépôt du modèle ne les fournit pas. Le décodeur tourne toujours en int8 (sur ce modèle, le joiner int8 est aussi précis que fp32, tout en étant plus léger et plus rapide). Le dépôt du modèle fournit aussi un encodeur **fp16** (~1,2 Go, généré par `scripts/quantize-fp16.py` dans le dépôt [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx)) pour le backend WebGPU, utilisé lorsque la machine se retrouve sur WebGPU et que son GPU prend en charge `shader-f16` (sinon c'est l'encodeur fp32 en fragments qui sert) |
| 📊 **Banc d'essai en un clic** | Une section de la barre latérale mesure tous les moteurs et toutes les précisions que votre appareil peut réellement exécuter, sur un extrait audio livré avec l'application, et produit un rapport anonymisé unique que vous pouvez lire, copier ou (si l'instance les collecte) envoyer pour aider à optimiser l'application pour du matériel comme le vôtre. Voir [Banc d'essai](#banc-dessai) |
| 🐳 **Prêt pour Docker** | Déploiement auto-hébergé en une seule commande |
| 🔌 **API compatible OpenAI** | Mode sans interface optionnel : servez le même pipeline via l'API de transcription audio d'OpenAI (ainsi que les dialectes whisper.cpp et whisper-asr-webservice) pour que des clients existants transcrivent en local, avec le renforcement de phrases et l'identification des locuteurs pilotables par requête. Voir [Serveur d'API compatible OpenAI](#serveur-dapi-compatible-openai) |

> **Prévu :** au fur et à mesure de la maturation du projet, je souhaite à terme ajouter la prise en charge de [WEBCAT](https://github.com/freedomofpress/webcat/) (Web-based Code Assurance and Transparency) pour des garanties de sécurité encore plus fortes, afin que vous puissiez vérifier cryptographiquement que le code exécuté dans votre navigateur est bien celui qui a été réellement publié.

## Démarrage rapide

```bash
# 1. Copiez le fichier d'environnement d'exemple et éditez-le avec vos propres valeurs
cp docker/env.example docker/.env

# 2. Lancez la démo localement avec Docker
sudo docker compose -f docker/docker-compose.yml up
```

3. Rendez-vous ensuite sur `http://localhost:5173`

## Choisir entre CPU et GPU

L'application fixait auparavant chaque utilisateur sur le backend WASM (CPU) avec l'encodeur int8, pour une raison qui s'est depuis révélée fausse. Cela mérite d'être raconté correctement, car la mauvaise réponse a paru convaincante pendant un an.

WebGPU mesurait autrefois environ 15x plus lent que WASM int8 sur ce modèle. La faute en revenait à l'encodeur (un Conformer), qui émet des centaines d'opérateurs à forme dynamique pour lesquels le moteur WebGPU du navigateur ([onnxruntime-web](https://onnxruntime.ai/)) n'a pas de noyaux GPU : il les exécute sur le CPU, découpant l'encodeur en îlots GPU/CPU, et le GPU restait proche de 0 % d'utilisation alors que les poids étaient manifestement en VRAM. Cette explication collait au symptôme et était pourtant fausse.

La vraie cause était la page elle-même. Le moteur rend la main à la boucle d'événements environ 2000 fois par exécution de l'encodeur, et Chromium ne délivre ces rappels qu'au rythme où la page produit des images de composition, et ce pour tout le processus. Le simple indicateur d'attente animé taxait donc chacune de ces 2000 interruptions. Mettre en pause les animations de la page pendant toute la durée d'une exécution GPU a supprimé la totalité de cette taxe : le même extrait de 3 minutes est passé de 12 min 39 s à 8,5 s. Sur la machine de référence (une RTX 3090 Ti), WebGPU traite désormais un enregistrement de 6,5 minutes en environ 19 s contre environ 102 s pour WASM int8, soit environ 5x plus rapide au lieu de 15x plus lent.

WebGPU est donc de nouveau disponible. Il n'est pour autant pas sélectionné pour tout le monde, car « le GPU est-il plus rapide ici » est une question sur votre machine, pas sur ce modèle, et se tromper coûte cher dans un sens : la voie GPU télécharge 1,2 à 2,4 Go de poids au lieu d'environ 600 Mo. Plutôt que d'extrapoler d'un seul GPU mesuré à tous les visiteurs, l'application mesure la machine sur laquelle elle tourne et ne bascule vers le GPU qu'en cas de gain net (voir [Configuration automatique](#configuration-automatique--mesurer-plutôt-que-supposer) ci-dessous). Une machine sans GPU, ou dont le GPU ne peut pas exécuter le modèle, reste sur la voie CPU exactement comme avant.

Si vous devez écarter le GPU (dépannage, ou pilote capricieux), ajoutez `?webgpu=0` à l'adresse et rechargez : cela force WASM pour ce chargement de page sans modifier vos réglages. (Cette analyse, ainsi que l'application, ont été réalisées avec l'aide de [Claude Code](https://claude.com/claude-code).)

## Configuration automatique : mesurer plutôt que supposer

Savoir si un GPU bat le CPU pour ce travail dépend entièrement de la machine : l'application le mesure donc sur place au lieu de le supposer. Deux petits graphes ONNX (environ 5 Mo au total, livrés avec l'application) sont téléchargés discrètement en arrière-plan d'un chargement de page normal, et au premier chargement du modèle ils sont chronométrés sur les deux voies : celui en int8 via WASM, celui en fp32 via WebGPU, ce qui correspond à ce que chaque backend exécuterait réellement. Le plus rapide gagne et est sélectionné avant le début du téléchargement, si bien que le verdict décide des poids que vous récupérez.

Quelques détails qui comptent plus qu'il n'y paraît :

- **Le basculement vers le GPU n'a lieu qu'en cas de gain net** (au moins 2x). Un GPU à peine devant ne vaut pas 1,2 à 2,4 Go de téléchargement supplémentaire.
- **Tout échec vous laisse sur le CPU.** Pas d'adaptateur, un GPU incapable d'exécuter le graphe, une mesure cassée ou une branche qui se bloque : tout cela aboutit à WASM, parce que c'est la réponse qui ne coûte rien.
- **Cela ne remplace jamais un choix que vous avez fait.** Choisissez un backend vous-même et la mesure cesse de décider à votre place.
- **Cela s'exécute une fois par machine.** Le verdict est conservé et réutilisé, et n'est remesuré qu'en cas de mise à jour de l'application, de changement de GPU, ou au bout de 90 jours, car une mise à jour de pilote peut modifier silencieusement la vitesse du GPU.
- **Vous pouvez la relancer à tout moment** avec le bouton « Configurer automatiquement les performances » dans les paramètres.

La mesure met les animations de la page en pause pendant son exécution, pour la même raison que les vraies exécutions GPU (voir ci-dessus). Sur une machine sans GPU, et sous `?webgpu=0`, rien de tout cela ne s'exécute ni ne télécharge quoi que ce soit. (Réalisé avec l'aide de [Claude Code](https://claude.com/claude-code).)

## Moteur CPU plus rapide (Relaxed-SIMD)

L'application embarque une seconde version du moteur WASM de ONNX Runtime, compilée avec [Relaxed SIMD](https://github.com/WebAssembly/relaxed-simd), dont l'instruction de produit scalaire int8 compacté accélère nettement le calcul matriciel quantifié sur les navigateurs dont le moteur en tire profit (environ 19 % plus rapide de bout en bout mesuré sur les navigateurs de la famille Chromium avec le modèle int8 ; Firefox valide ces instructions mais ne les exécute pas plus vite, il reste donc sur le moteur standard).

Par défaut le réglage est Auto : au premier chargement du modèle, l'application exécute un micro-benchmark d'environ 40 ms du motif d'instructions exact dans votre navigateur et choisit le moteur le plus rapide, si bien que les utilisateurs de Chrome/Brave/Edge profitent de l'accélération et tous les autres gardent la version standard. Vous pouvez forcer Activé ou Désactivé dans les réglages (appliqué au prochain chargement de page). La qualité de transcription est inchangée dans tous les cas (vérifié par un benchmark WER/CER sur l'intégralité des jeux de validation FLEURS français+anglais).

Comme il s'agit d'un binaire compilé maison plutôt que celui publié sur npm, il est produit par un builder Docker reproductible à chaîne d'outils épinglée (`scripts/build-ort-relaxed-docker.sh --repro-check`, qui le compile deux fois dans des conteneurs neufs et n'installe qu'un résultat identique au bit près) et il est livré avec ses fichiers de provenance `SHA256SUMS` et `BUILD-INFO`, pour que chacun puisse le recompiler et comparer. Les auto-hébergeurs peuvent à tout moment ramener tous les visiteurs sur le moteur standard de npm avec la variable d'environnement `VITE_ORT_RELAXED_ENABLE=false`, sans reconstruction. (Réalisé et mesuré avec l'aide de [Claude Code](https://claude.com/claude-code).)

## Mode dictée

Parakeet Web inclut un **mode dictée expérimental** qui post-traite les transcriptions à l'aide de règles regex pour nettoyer la ponctuation dictée, le vocabulaire médical et les abréviations d'unités. C'est particulièrement utile pour la dictée médicale en français.

Les règles regex proviennent du [dépôt murmure-regex](https://framagit.org/interhop/murmure-regex) de l'association à but non lucratif [interhop.org](https://interhop.org/), créées à l'origine pour le logiciel [Murmure](https://github.com/Kieirra/murmure). Un unique fichier CSV combiné est téléchargé automatiquement au démarrage du conteneur. J'étudie la possibilité de contribuer à [Murmure](https://github.com/Kieirra/murmure) en amont.

Les règles sont en français et couvrent des catégories telles que la ponctuation, les abréviations d'unités, les modèles d'examen clinique, les corrections de noms de médicaments et les corrections de vocabulaire médical.

Cette fonctionnalité est très précoce et s'améliorera rapidement.

### Comment ça marche

- **Docker** : le script d'entrée télécharge l'unique fichier combiné `regex.csv` depuis le [dépôt murmure-regex](https://framagit.org/interhop/murmure-regex) à chaque démarrage du conteneur.
- **Frontend** : l'application charge les règles CSV au démarrage via un fichier manifeste et les applique comme des remplacements JavaScript `RegExp`. Après le traitement regex, chaque ligne est débarrassée des espaces de début/fin et sa première lettre est mise en majuscule. Deux modes d'affichage sont disponibles par transcription : **Brut** et **Dictée** (nettoyé par regex).
- **Source regex personnalisée** : définissez la variable d'environnement `DICTATION_REGEX_SOURCE` pour remplacer l'URL Murmure par défaut. Il peut s'agir d'une URL de dépôt compatible GitLab (par ex. `https://framagit.org/interhop/murmure-regex`) ou d'un chemin de dossier local contenant des fichiers regex CSV (par ex. `/path/to/my/regex-csvs`). Cela vous permet d'itérer sur les règles regex localement sans attendre les changements en amont.

## Identification des locuteurs

Parakeet Web peut répondre à la question **« qui parle quand »** : il découpe une transcription en tours de parole par locuteur, en regroupant les mots en blocs colorés `Premier :`, `Deuxième :`, `Troisième :` ... (au-delà du douzième, repli sur `Locuteur 13 :` et au-delà). Tout s'exécute **localement dans votre navigateur** : aucun audio ne quitte votre appareil, exactement comme la transcription elle-même.

L'identification des locuteurs est entièrement **optionnelle** et ne se lance jamais sans votre action :

- **Par transcription** : un bouton **Locuteurs** se trouve juste après le bouton **Dictée** de chaque transcription. Cliquez dessus pour identifier les locuteurs de cette transcription ; la vue passe alors en tours de parole colorés. Cliquez sur **Brut** / **Dictée** pour revenir en arrière.
- **Automatiquement pour tout** : dans le panneau de paramètres, réglez le mode d'affichage par défaut sur **Locuteurs** (à côté de **Brut** et **Dictée**). Chaque nouvelle transcription est alors traitée automatiquement, comme le mode dictée par défaut.

Le **nombre de locuteurs est détecté automatiquement** par défaut, vous n'avez donc pas à le préciser. Si vous le connaissez, vous pouvez fixer un nombre :

- un contrôle **Nombre de locuteurs** dans le panneau de paramètres définit la valeur par défaut (**Auto**, ou 1-10), et
- le menu **⋮** de chaque transcription possède son propre remplacement **Nombre de locuteurs** qui **re-segmente cet enregistrement** lorsque vous le modifiez (pratique quand la détection auto sur-découpe ou sous-découpe un extrait précis). La re-segmentation s'exécute dans un worker en arrière-plan, donc la page ne se fige jamais ; un bouton **Annuler** à côté de **Locuteurs** interrompt un traitement en cours.

**Renommer les locuteurs** : cliquez sur une étiquette de locuteur (par ex. **Premier**) pour la modifier directement. Le nouveau nom remplace ce locuteur partout dans la transcription. **Fusionnez deux locuteurs** en renommant l'un avec l'étiquette actuelle de l'autre (par ex. renommez **Troisième** en **Deuxième**) : ils fusionnent en un seul locuteur d'une seule couleur, et les couleurs/numéros se re-compactent sans laisser de trous. La **copie** d'une transcription identifiée produit des blocs `Nom : texte` propres, prêts à coller.

**Réutiliser les noms entre enregistrements** : une fois que vous avez nommé un locuteur, l'identification d'un autre enregistrement dans la même session réutilise automatiquement ce nom pour la même voix. L'application compare une empreinte vocale de chaque locuteur à celles que vous avez déjà nommées et vous propose l'étiquette correspondante (vous pouvez toujours la modifier). Cette mise en correspondance se fait entièrement en mémoire, pour la session en cours uniquement : les empreintes vocales sont des données biométriques, elles ne sont donc jamais écrites sur le disque et disparaissent au rechargement de la page.

**Conservation** : lorsque l'option **Sauvegarder l'historique des transcriptions localement** est activée, les tours de parole et vos noms personnalisés sont enregistrés avec le texte, de sorte qu'une transcription identifiée revient dans la vue **Locuteurs** (mêmes couleurs et étiquettes renommées) après un rechargement. Pour préserver la confidentialité, seuls les tours regroupés (`Locuteur : texte`) et les noms sont stockés, jamais les horodatages par mot ni les segments audio bruts.

### Comment ça marche

L'identification des locuteurs s'appuie sur [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), dont le moteur de diarisation WebAssembly précompilé est intégré à l'application (il embarque son propre ONNX Runtime, distinct du moteur de transcription). Il exécute un pipeline hors ligne à deux modèles sur le même audio 16 kHz déjà en mémoire :

1. un modèle de segmentation [pyannote](https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0) repère les zones de parole et les changements de locuteur, puis
2. un modèle d'empreinte vocale [3D-Speaker CAM++](https://huggingface.co/csukuangfj/speaker-embedding-models) (~28 Mo) encode chaque zone, et les empreintes sont regroupées par locuteur.

Les segments de locuteurs obtenus sont mis en correspondance avec les horodatages de mots existants (chaque mot reçoit le locuteur dont le segment le chevauche le plus), et les mots consécutifs d'un même locuteur sont regroupés en tours de parole.

- Les deux modèles (~34 Mo au total) sont récupérés depuis le même hub que le modèle ASR (variables d'environnement `VITE_DIARIZATION_*`, avec un repli local `/models`) et mis en cache dans IndexedDB. Ils sont préchargés en arrière-plan dès que le modèle ASR a fini de se charger, pour que la première identification soit instantanée. Si ce téléchargement échoue, le bouton **Locuteurs** et l'option d'affichage par défaut **Locuteurs** sont grisés et affichent la raison au survol (au lieu d'une fenêtre d'erreur).
- Le moteur WebAssembly ne se charge qu'à la première identification effective, donc il ne coûte rien si vous n'utilisez jamais la fonctionnalité.

Cette fonctionnalité a été mise en place avec [Claude Code](https://www.anthropic.com/claude-code).

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
  - `phrase:POIDS:MINP`, par ex. `venlafaxine:5:0.1`, définit une **barrière min-p** par phrase : la phrase n'est poussée que lorsque son token est au moins `MINP` fois aussi probable que le meilleur candidat du modèle pour cette étape. Cela maintient le renforcement comme un coup de pouce au classement plutôt qu'un marteau qui pourrait halluciner une phrase que le modèle n'a jamais considérée, et contrairement à un top-k fixe, cela s'adapte à la confiance du modèle à chaque étape (serré près d'un pic confiant, plus large quand le modèle hésite). Le min-p par défaut est 0.1 (au moins 10 % aussi probable que le meilleur candidat).
- **Force de renforcement** : un multiplicateur global appliqué par-dessus le poids de chaque phrase. Va de -10 à 10 ; mettez-le à 0 pour désactiver le renforcement sans effacer votre liste. Une force négative inverse toutes les phrases d'un coup (les renforcements deviennent des pénalités).
- **Augmenter une phrase en formes supplémentaires** : le décodeur compare des tokens sensibles à la casse, donc `venlafaxine` seul ne correspond pas à `Venlafaxine`. Ajoutez le champ `AUG` (le troisième champ séparé par deux-points, voir la référence ci-dessous) pour décliner une phrase en Casse De Titre, MAJUSCULES, préfixes proclitiques (si bien qu'un terme commençant par une voyelle comme `amoxicilline` renforce aussi `l'amoxicilline` / `d'amoxicilline`) et formes sans symboles (si bien que `alpha-methyl` renforce aussi `alpha methyl`), ex. : `amoxicilline:5::faph`. Appliquez-le à toutes les lignes suivantes d'un coup avec une ligne de valeurs par défaut `*:::AUG`.

Votre liste de phrases et la force sont enregistrées localement (IndexedDB) et survivent aux rechargements. Comme tout le reste de cette application, le renforcement fonctionne **100% dans votre navigateur** : rien de vos phrases n'est envoyé où que ce soit.

**Listes fournies par l'opérateur (optionnel, auto-hébergé) :** définissez la variable d'environnement `BOOST_PHRASES_SOURCE` sur un dossier local de fichiers `.txt` (une phrase par ligne, même syntaxe par ligne que la boîte de saisie) ou sur une URL https pointant vers un unique fichier `.txt`. Lorsqu'au moins une liste est trouvée, un sélecteur apparaît au-dessus de la boîte pour que les utilisateurs puissent choisir quelle liste charger ; en choisir une remplit la boîte avec le contenu de ce fichier. Le sélecteur inclut toujours une entrée **Personnalisé** pour saisir vos propres phrases (et ce texte personnalisé est enregistré entre les sessions indépendamment des fichiers chargés) ainsi qu'une entrée **Désactivé** qui coupe le boosting ; passer sur **Désactivé** est instantané même depuis une très grande liste, car cela vide simplement les phrases sans rien reconstruire. Une liste servie peut être pré-réglée en portant ses propres valeurs par défaut par phrase sur une ligne `*:POIDS:MINP:AUG` (voir la référence dépliable ci-dessous), et les très grandes listes peuvent être précompilées en fichiers `.pwc` pour que le conteneur évite de les ré-encoder à chaque démarrage (un gain au démarrage du serveur, pas côté visiteur ; voir la référence dépliable ci-dessous). Lorsque la variable n'est pas définie, aucun sélecteur n'est affiché et la boîte fonctionne exactement comme décrit ci-dessus (saisie manuelle uniquement). Le `docker-compose.yml` fourni embarque une liste curée prête à l'emploi : il monte (bind-mount) le dossier `phrase_boosting/` du dépôt (actuellement une liste `french_medical`) à `/boost-defaults` et fixe `BOOST_PHRASES_SOURCE` par défaut sur ce chemin, si bien que le sélecteur est rempli sans configuration supplémentaire. Mettez `BOOST_PHRASES_SOURCE=` (vide) dans votre `.env` pour ne servir aucune liste.

**Pré-sélectionner une liste par défaut :** définissez `VITE_PHRASE_BOOST_DEFAULT` sur l'un des noms de liste servis (un nom simple comme `medical` ou `medical.txt`) pour qu'elle soit pré-sélectionnée pour les nouveaux visiteurs. Le conteneur refuse de démarrer si le nom ne correspond à aucune liste qu'il sert, de sorte qu'une faute de frappe de l'opérateur ne peut jamais retomber silencieusement sur la saisie manuelle. Vous pouvez aussi pré-sélectionner une liste lien par lien avec le paramètre d'URL `?phrase_boost=<nom>` (ex. `https://votre-hote/?phrase_boost=medical`), pratique pour partager un lien prêt à l'emploi. Ni la valeur par défaut d'environnement ni le paramètre d'URL ne remplacent la sélection enregistrée d'un utilisateur de retour ; ils ne fixent le défaut que lorsque le visiteur n'a pas encore de choix enregistré. Le `docker-compose.yml` fourni fixe cette valeur par défaut sur `french_medical` (la liste embarquée) ; mettez `VITE_PHRASE_BOOST_DEFAULT=` (vide) dans votre `.env` pour ne rien pré-sélectionner.

<details>
<summary><strong>Syntaxe complète par ligne, fonctionnement du renforcement et listes précompilées</strong></summary>

#### Syntaxe par ligne

Chaque ligne est `phrase` suivie de jusqu'à trois champs optionnels séparés par des deux-points, `phrase:POIDS:MINP:AUG` :

- `POIDS` (par défaut 1) : le poids de renforcement, de -10 à 10 (non nul). Positif pousse *vers* la phrase, négatif *à l'écart* (une pénalité). Hors plage ou nul est ignoré avec un avertissement en ligne et traité comme 1.
- `MINP` (par défaut 0.1) : la barrière min-p par phrase, un nombre dans (0, 1] ; la phrase n'est poussée que lorsque son token est au moins `MINP` fois aussi probable que le meilleur candidat du modèle pour cette étape. Contrairement à un rang top-k fixe, cela s'adapte à la confiance du modèle à chaque étape.
- `AUG` (par défaut aucune) : augmente cette phrase en formes supplémentaires. N'importe quel mélange de `f` (Casse De Titre), `a` (MAJUSCULES), `p` (préfixes proclitiques, par ex. `l'`/`d'` collés à un terme commençant par une voyelle) et `h` (suppression des symboles/séparateurs, si bien que `alpha-methyl` renforce aussi `alpha methyl` ; couvre `, . ' " - _ ? !` et consorts). Deux raccourcis : `s` n'en force aucune (telle quelle) et `i` les active toutes. Omettez pour laisser la phrase telle quelle, ou définissez une valeur par défaut pour toute la liste avec une ligne `*:::AUG` (voir ci-dessous).

Laissez un champ antérieur vide pour conserver sa valeur par défaut tout en définissant un champ ultérieur, par ex. `venlafaxine::0.1` conserve le poids 1 mais fixe le min-p à 0.1, et `amoxicilline:5::faph` définit les trois.

Une liste peut arriver pré-réglée grâce à une ligne de valeurs par défaut `*:POIDS:MINP:AUG` : elle fixe le poids, le min-p et l'augmentation par défaut pour chaque ligne qui la suit (jusqu'à ce qu'une autre ligne `*` les change), avec exactement les mêmes champs qu'une phrase. Ainsi `*:2` met le reste de la liste au poids 2, `*:::faph` augmente le reste, et `*:1.5:0.1:fhp` définit les trois ; chaque champ vide laisse cette valeur par défaut inchangée, et un champ par phrase l'emporte toujours sur la valeur par défaut `*`. Un poids `*` est une valeur *par défaut* par phrase, pas le multiplicateur global : le curseur de force multiplie encore l'ensemble (vos phrases saisies et la liste) par-dessus, si bien qu'un `*:2` de la liste avec un curseur à 1,5 donne un poids effectif de 3. Une liste peut aussi remplacer les préfixes proclitiques utilisés par l'augmentation `p` avec une ligne `#!prefixes a' b' ...` (séparés par des espaces) ; le défaut est l'ensemble d'élision française (`l'`, `d'`, `L'`, `D'`). Un préfixe se terminant par une apostrophe ne s'attache que devant une voyelle (donc `l'amoxicilline` mais jamais `l'beta`) ; tout autre préfixe (par ex. l'arabe `al-`) s'attache sans condition.

#### Comment ça marche

Il s'agit d'un portage navigateur du *concept* derrière le [Phrase-Boosting accéléré par GPU](https://github.com/NVIDIA-NeMo/NeMo/pull/14277) de NVIDIA NeMo (voir aussi le ticket [#14772](https://github.com/NVIDIA-NeMo/NeMo/issues/14772)). Chaque phrase est tokenisée avec une réimplémentation fidèle du tokeniseur BPE du modèle et insérée dans un **trie de renforcement** au niveau des tokens. Pendant le décodage, avant que chaque token ne soit choisi, le trie ajoute une récompense additive (fusion superficielle) dans l'**espace des logits** aux tokens qui commenceraient ou continueraient l'une de vos phrases. Cette récompense est proportionnelle à la part de la phrase que la correspondance engage : le premier token d'une phrase longue ne gagne donc qu'une fraction de son poids, et le poids complet n'est atteint qu'à l'achèvement de la phrase. Sans cela, un token qui ne fait que *commencer* une phrase serait récompensé autant qu'un token qui la termine presque, et sur une grande liste cela place un bonus permanent sur une large part du vocabulaire à chaque étape (une source fiable de mots insérés à tort). Les correspondances plus profondes sont en outre un peu plus récompensées, pour encourager la finition d'une phrase une fois commencée. Ajouter à un logit est le coup de pouce principiel dans le domaine logarithmique : cela multiplie la probabilité de ce token avant que le softmax ne renormalise, plutôt que de mettre grossièrement à l'échelle la probabilité finale. Une **barrière min-p** garde la récompense honnête : un token n'est renforcé que lorsque sa probabilité atteint au moins une fraction fixe de celle du meilleur candidat du modèle pour cette étape (par défaut 0.1, soit 10 %, configurable par phrase), de sorte qu'un poids fort pousse le classement sans forcer un mot que le modèle n'a jamais considéré. C'est la règle min-p de l'échantillonnage des LLM : elle s'adapte à la distribution de chaque étape (serrée près d'un pic confiant, plus large quand le modèle hésite), là où un rang top-k fixe admettrait du bruit sur les étapes confiantes et raterait un terme rare mais plausible sur les étapes incertaines. Un poids négatif applique la même récompense avec le signe opposé, pénalisant la phrase à la place.

À une largeur de faisceau de 1, cette application décode de façon **gloutonne** (un meilleur token par étape), donc le renforcement fait au mieux : il biaise chaque étape vers vos phrases, mais il ne peut pas récupérer une phrase que le décodeur glouton a déjà écartée à une étape antérieure. Augmenter le paramètre **Largeur de faisceau (Beam Width)** (transcription de fichier uniquement ; voir ci-dessous) laisse le décodeur conserver plusieurs hypothèses concurrentes, de sorte qu'une phrase renforcée peut survivre dans un faisceau de rang inférieur jusqu'à ce que l'audio la confirme, ce qui est exactement le cas que le glouton ne peut pas récupérer. La recherche en faisceau coûte environ Nx le temps de décodage pour une largeur N, et un banc d'essai a montré qu'un faisceau plus large n'aide que lorsqu'une liste de phrases donne au décodeur un vocabulaire à viser (sans liste, il est plus lent et légèrement moins précis sur la parole technique), donc la valeur par défaut est automatique et couplée au renforcement : gloutonne tant qu'aucune liste de phrases n'est chargée, puis une largeur adaptée à l'appareil (jusqu'à 5 sur un ordinateur de bureau typique) dès qu'une liste l'est. Fixer la largeur vous-même désactive ce couplage automatique. La force de renforcement aide aussi, mais de très grandes valeurs peuvent déformer un texte autrement correct, alors commencez petit et augmentez seulement au besoin. Le texte latin accentué et les ligatures (par ex. `isotrétinoïne`, `sœur`) sont entièrement pris en charge. Les écritures pour lesquelles le tokeniseur n'a aucun token (par ex. chinois/japonais/coréen) s'effondrent en un seul token inconnu et ne peuvent pas être renforcées ; de telles phrases sont automatiquement ignorées et listées dans un avertissement en ligne plutôt que silencieusement écartées. Il s'agit d'une limitation du tokeniseur, pas d'un bug.

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

## Serveur d'API compatible OpenAI

L'application navigateur reste le produit ; mais le même pipeline peut aussi être servi sans interface, en HTTP, pour un client qui parle déjà l'**API de transcription audio d'OpenAI** (les SDK OpenAI, Open WebUI, des greffons de prise de notes, le client de `whisper.cpp`, un script curl). Ce serveur se trouve dans [`scripts/openai-like-server/`](./scripts/openai-like-server/README.md) et fournit son propre `Dockerfile` durci et son `docker-compose.yml`.

```bash
cd scripts/openai-like-server
cp env.example .env                 # MODEL_DIR est la seule valeur obligatoire
docker compose up -d --build

curl -sS -F file=@reunion.ogg http://127.0.0.1:8002/v1/audio/transcriptions
# {"text":"..."}
```

Ce qu'il apporte de plus qu'une simple encapsulation :

- `POST /v1/audio/transcriptions` avec `json` / `text` / `srt` / `vtt` / `verbose_json`, ainsi que les orthographes de whisper.cpp (`POST /inference`) et de whisper-asr-webservice (`audio_file`, `output`, `initial_prompt`, `hotwords`, ...).
- **Le renforcement de phrases en HTTP** : choisissez une liste par requête avec `phrase_boost=<nom>`, ou envoyez des termes en ligne. Le champ `prompt` d'OpenAI atterrit ici, parakeet n'ayant aucun conditionnement textuel par lequel l'orienter.
- **L'identification des locuteurs** en option via `diarize=true`, avec le moteur utilisé par l'application navigateur, donc des étiquettes identiques.
- Les options et champs whisper qu'il ne peut pas honorer sont **refusés avec une explication**, jamais ignorés en silence : une transcription correspond toujours à ce qui a été demandé.
- Authentification Bearer (clé vide = aucune authentification, et il refuse de démarrer sans clé sur une adresse non locale), file d'attente FIFO stricte avec 429/504, plafond de téléversement, conteneur non-root en lecture seule, et un journal qui ne contient jamais vos transcriptions.

Il **importe** le pipeline de ce dépôt au lieu de le réimplémenter : sa sortie est donc identique octet pour octet à celle de la CLI `scripts/transcribe.mjs` à options égales. Voir son [README](./scripts/openai-like-server/README.md) pour la référence complète de l'API.

Construit avec [Claude Code](https://claude.com/claude-code).

## Banc d'essai

La barre latérale contient une section **Banc d'essai** qui mesure, en un clic, tous les moteurs et toutes les précisions que votre appareil peut réellement exécuter, et rassemble le résultat dans un rapport unique que vous pouvez lire, copier ou envoyer à la personne qui héberge l'instance.

Pourquoi elle existe : la vitesse de l'application dépend de matériel que le mainteneur ne possède pas (le niveau de SIMD exposé par votre processeur, le nombre de cœurs réellement libres, l'adaptateur GPU que votre navigateur expose, la façon dont le moteur WASM de votre navigateur compile les noyaux de calcul). Des mesures réelles sur des machines réelles sont le seul moyen de décider quoi optimiser ensuite.

**Ce qu'elle fait.** Elle transcrit un court extrait livré avec l'application (11 s du discours d'investiture de JFK, dans le domaine public) une fois par combinaison sélectionnée, en passant exactement par le même code qu'une transcription normale : les chiffres décrivent donc ce que vous obtenez vraiment, et non un micro-banc d'essai synthétique. Vous pouvez ajouter un profil audio long (l'extrait répété jusqu'à environ 90 s, ce qui sollicite le découpage en morceaux, le recollement des coutures et l'encodage parallèle) et demander jusqu'à 3 exécutions par combinaison, auquel cas la médiane est rapportée.

**Avant de commencer.** Un seul modèle est conservé dans le cache du navigateur à la fois : tester plusieurs précisions les télécharge donc l'une après l'autre, et le modèle que vous utilisez habituellement est retéléchargé ensuite. Le téléchargement estimé est affiché au-dessus du bouton, la ligne que vous utilisez déjà ne coûte rien, et les lignes fp32 (~2,3 Go) ne sont jamais présélectionnées. L'exécution se termine sur votre propre combinaison, de sorte que le cache conserve à la fin le modèle que vous utilisez vraiment.

**Ce que contient le rapport :** les mesures de temps (chargement du modèle, temps total, temps par seconde d'audio, répartition encodage/décodage), ce que votre processeur et votre GPU prennent en charge (nombre de cœurs, mémoire, SIMD et threads WASM, l'adaptateur WebGPU avec ses fonctionnalités et ses limites, la configuration ONNX Runtime en vigueur), les réglages de l'application qui changent la vitesse (threads, largeur du faisceau, fenêtre de découpage, renforcement de phrases actif ou non), et un score de similarité de chaque transcription avec la phrase connue de l'extrait, ce qui permet de détecter un moteur qui renvoie silencieusement du vide.

**Ce qu'il ne contient pas :** aucun audio, aucune transcription, aucun user agent, aucun fuseau horaire, aucune langue, aucune taille d'écran, aucune estimation de stockage, et aucun identifiant d'aucune sorte. L'anonymisation fonctionne par liste blanche et non par liste noire : une sonde ajoutée plus tard ne peut donc pas se retrouver par accident dans un rapport, et les deux moitiés de cette promesse (ce qui est conservé, ce qui ne doit jamais apparaître) sont vérifiées par la suite de tests, y compris dans un vrai navigateur.

**L'envoi est toujours une décision.** Le texte complet du rapport est affiché avant que quoi que ce soit ne se produise. Rien n'est transmis tant que vous n'appuyez pas sur « Envoyer au développeur » ; une case à cocher permet d'accepter l'envoi automatique des rapports suivants, une fois que vous avez vu à quoi l'un d'eux ressemble. Si l'instance ne collecte pas de rapports, le bouton d'envoi n'existe pas du tout et la section se limite à la copie.

### Collecter les rapports (auto-hébergement)

La collecte des rapports est désactivée par défaut. Pour l'activer sur votre propre instance :

1. Décommentez le volume `../benchmark_reports:/benchmark-reports` dans `docker/docker-compose.yml`.
2. Définissez `BENCHMARK_REPORTS_DIR=/benchmark-reports` dans `docker/.env`.
3. Assurez-vous que le dossier hôte appartient à l'UID 1000 (le conteneur écrit sous cet utilisateur).

Le point d'entrée teste l'accès en écriture au démarrage et en déduit l'interrupteur côté client : un dossier dans lequel il ne peut pas écrire laisse donc la section en mode copie seule, avec un avertissement dans les journaux du conteneur, plutôt que de montrer aux visiteurs un bouton qui échoue toujours.

Les rapports arrivent sur `POST /api/signal/benchmark-report` du service de signalisation : limité à 3 par minute et par IP, plafonné à 32 Ko chacun et à 20000 fichiers au total, avec vérification du format, et stocké à raison d'un rapport par fichier sous un nom choisi par le serveur lui-même (rien venant de la requête n'atteint un chemin). Rien concernant l'expéditeur n'est écrit à côté du contenu, car un rapport anonyme dans le navigateur ne doit pas cesser de l'être à l'arrivée.

## Réinitialiser l'application

Si un paramètre enregistré laisse un jour l'application dans un état bloqué ou figé
(au point que le bouton **Tout réinitialiser** intégré n'est plus accessible), chargez
la page avec `?reset` ajouté à l'URL, par exemple `https://votre-instance/?reset`. Cela
efface les paramètres enregistrés et démarre sur les valeurs par défaut ; le `?reset`
est ensuite retiré de la barre d'adresse afin qu'un rechargement normal ne purge pas à
nouveau. Votre historique de transcriptions est stocké séparément et reste intact. Un
repli via le hash `#reset` est aussi pris en compte lors d'un chargement ou d'un
rechargement neuf.

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

Le code de l'application est sous licence **AGPLv3** (voir le fichier LICENSE).

Certaines listes de phrase boosting fournies incluent des noms de bactéries dérivés de LPSN (List of Prokaryotic names with Standing in Nomenclature), qui est sous licence **CC BY-SA 4.0**, pas AGPLv3 : la liste `lorn` (List of Recommended Names for bacteria of medical importance) et les noms de bactéries fusionnés dans la liste `french_medical`. Voir [ATTRIBUTION.md](./ATTRIBUTION.md) pour les détails et l'attribution requise.

## Remerciements

- **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – Projet original dont celui-ci est forké
- **[LPSN (List of Prokaryotic names with Standing in Nomenclature)](https://lpsn.dsmz.de/)** – Source des noms de bactéries dans les listes de boosting `lorn` (List of Recommended Names for bacteria of medical importance) et `french_medical`, utilisés sous licence CC BY-SA 4.0 (voir [ATTRIBUTION.md](./ATTRIBUTION.md))
- **[nvidia/parakeet-tdt-0.6b-v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)** – Le modèle ASR sous-jacent par NVIDIA
- **[istupakov/parakeet-tdt-0.6b-v3-onnx](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx)** – Conversion ONNX du modèle
  - Cela a été essentiel pour me permettre de réaliser ma propre quantization améliorée, disponible sur [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx)
- **[istupakov/onnx-asr](https://github.com/istupakov/onnx-asr)** – Implémentation de référence en Python
- **ONNX Runtime Web** – Rend l'inférence dans le navigateur possible
- **[sherpa-onnx (k2-fsa)](https://github.com/k2-fsa/sherpa-onnx)** – Moteur WebAssembly précompilé d'identification des locuteurs (Apache-2.0)
- **[pyannote segmentation 3.0](https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0)** – Modèle de segmentation de la parole utilisé pour la diarisation (MIT)
- **[3D-Speaker CAM++](https://huggingface.co/csukuangfj/speaker-embedding-models)** – Modèle d'empreinte vocale utilisé pour la diarisation (Apache-2.0)

## Crédits

Ce fork est basé sur **[ysdede/parakeet.js](https://github.com/ysdede/parakeet.js)** – tout le gros du travail et le crédit de l'implémentation originale lui reviennent. Cela n'existerait pas sans leur excellent travail.
