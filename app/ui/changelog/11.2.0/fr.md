# 11.2.0 (2026-09-10)

## Le tableau du banc d'essai se remplit au fil des mesures

Un banc d'essai prend plusieurs minutes, et le tableau n'apparaissait qu'une fois toutes les combinaisons terminées. Le tableau complet s'affiche désormais dès que vous lancez la mesure : toutes les lignes prévues sont là dès le départ, marquées en attente, puis indiquent ce qu'elles font pendant qu'elles le font (chargement, transcription), puis se figent sur leur résultat. Le plan est visible pendant toute la durée du test, et une ligne déjà mesurée conserve son résultat quoi qu'il advienne des autres.

La colonne de vitesse a changé de sens. Elle indiquait des secondes de calcul par seconde d'audio, où plus petit valait mieux ; elle indique maintenant des secondes d'audio par seconde de calcul, donc 5x signifie cinq minutes d'enregistrement traitées en une minute, et plus grand vaut mieux. C'est ainsi que ce chiffre est cité partout ailleurs, et c'était la seule colonne du tableau où une petite valeur était une bonne nouvelle.

Les lignes que le test ne peut pas mesurer honnêtement le disent. Un chargement de banc d'essai n'accepte plus de précision de substitution : partout ailleurs dans l'application, répondre à un fichier manquant par un fichier existant rend service, mais dans un banc d'essai cela classerait les temps d'une autre précision sous le nom de cette ligne. Les combinaisons que la source ne peut pas fournir sont retirées du plan dès le départ, pour qu'un test ne passe pas des minutes à découvrir ce que la liste des fichiers disait déjà.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).

---

## Une précision absente de votre source change de fichier, pas de moteur

Lorsque la précision GPU demandée n'était hébergée nulle part, l'application vous basculait sur le processeur. Ce repli existe pour une bonne raison (la mesure automatique peut placer un visiteur sur le GPU sans qu'il l'ait choisi, et laisser ces visiteurs sur un chargement en échec serait pire), mais il répondait à un fichier manquant en abandonnant la carte graphique, ce que souhaite rarement quelqu'un qui a choisi le GPU.

L'application cherche désormais une autre précision que le GPU sait exécuter et que cette source héberge, en commençant par le plus petit téléchargement, et charge celle-là. Le moteur sur lequel vous êtes reste le moteur sur lequel vous êtes, et le message indique la précision demandée, celle qui a été chargée et sa taille approximative : un téléchargement surprise devient un téléchargement annoncé. Ce n'est que si aucune précision GPU ne peut être servie que l'ancien basculement vers le processeur se produit, avec le message qu'il a toujours eu.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).

---

## Les précisions que cette instance ne peut pas fournir sont grisées avant d'être choisies

Les boutons de précision d'encodeur décrivaient ce que l'application sait exécuter, pas ce que votre instance peut réellement lui fournir. Sur un déploiement dont la copie des modèles contient fp32, int8 et w4a8 mais pas fp16, choisir fp16 semblait parfaitement normal, lançait un chargement, et se terminait une minute plus tard sur un message expliquant que le fichier était absent et qu'un modèle processeur avait été chargé à la place. Tout était exact dans ce message, et tout arrivait trop tard.

L'application demande maintenant à la source de modèles ce qu'elle héberge pendant que la page charge encore, et grise les précisions que cette source ne peut pas fournir, chacune avec sa raison. C'est important parce que trois choses très différentes peuvent écarter une précision, et elles ne désignent pas les mêmes personnes : ce moteur ne sait pas l'exécuter, ce GPU n'annonce pas `shader-f16`, ou cette source de modèles n'héberge pas le fichier. La première est définitive, la deuxième relève de votre matériel et personne ne peut y remédier ici, la troisième est un fichier manquant que l'administrateur de votre instance peut copier. Dire à un visiteur que son GPU est en cause pour un fichier que personne n'a mis en miroir est la seule réponse qui n'aide personne.

Cela reste une indication, jamais un verrou. Si la liste des fichiers ne peut pas être lue, ou n'a pas encore répondu, toutes les précisions restent proposées exactement comme avant : une vérification incertaine ne doit jamais retirer un choix qui aurait fonctionné.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).

---

## Le panneau de réglages indique désormais ce qui tourne réellement

Tous les réglages de modèle du panneau décrivent une demande : quel dépôt, quel moteur, quelle précision d'encodeur le prochain chargement va réclamer. Ce que l'application charge ensuite a le droit d'être différent, et pour de bonnes raisons. Une précision que votre source ne peut pas servir est remplacée. Un visiteur que la mesure de performance a placé sur le GPU est ramené sur le processeur si l'installation ne fournit aucun encodeur exécutable sur GPU. Les poids peuvent venir du serveur qui héberge cette application plutôt que de HuggingFace.

Rien de tout cela n'était visible. Les boutons continuaient d'afficher la demande : une machine pouvait donc rester sur « WebGPU / fp32 » pendant qu'un modèle int8 sur processeur faisait le travail, sans que l'interface ni la transcription n'en disent un mot.

Lorsqu'un repli se produit, les réglages eux-mêmes bougent désormais : le bouton de moteur le faisait déjà (il le doit, puisque la nouvelle tentative le relit), et la précision d'encodeur suit maintenant, de sorte que les réglages enregistrés cessent de contredire ce qu'affiche le panneau. Seule la précision du moteur réellement chargé est corrigée, et seulement tant que c'est encore celui qui est sélectionné ; le sélecteur de dépôt n'est jamais touché : un changement de modèle que vous venez de demander ne doit pas être annulé à votre insu.

Une ligne **Actuellement chargé** figure maintenant au-dessus de ces réglages dès qu'un modèle est en place, et nomme le moteur, la précision réellement montée et la provenance des poids. Elle n'apparaît qu'une fois quelque chose de chargé et disparaît dès que le modèle est libéré, si bien qu'elle ne peut jamais décrire un modèle qui n'est plus là. Lorsque ce qui est chargé diffère de ce qui est sélectionné, la ligne le signale et indique qu'un rechargement appliquera la sélection.

Deux choses qu'elle se garde de faire. Des poids venant de ce serveur plutôt que de HuggingFace sont indiqués mais pas signalés comme un désaccord : ils ne contredisent aucun de vos choix, et un avertissement qui se déclenche à chaque chargement d'une installation autonome est un avertissement qu'on cesse de lire. Et un chargement incapable de rapporter sa précision n'affirme rien à son sujet plutôt que d'inventer une divergence.

Écrit avec [Claude Code](https://claude.com/claude-code).

---

## Un réseau bloqué ne coûte plus un délai d'attente de connexion

Dans la configuration par défaut, l'application demande d'abord les poids à HuggingFace et ne se rabat sur la copie servie par votre propre instance qu'une fois cette tentative échouée. Sur un réseau normal, cet ordre ne coûte rien. Sur un réseau qui absorbe le trafic sortant au lieu de le refuser (un pare-feu d'hôpital ou de laboratoire, typiquement), l'échec n'est pas un refus mais un blocage : le navigateur attend l'expiration de son propre délai de connexion pendant qu'une copie locale parfaitement utilisable reste inutilisée, et la barre de progression reste donc figée une minute ou plus avant que quoi que ce soit ne commence à se télécharger.

L'application pose désormais la question en arrière-plan dès le chargement de la page, avec son propre budget de quatre secondes, et retient la réponse. Si HuggingFace n'a pas répondu, le chargement démarre depuis la copie servie par votre propre instance et saute entièrement la tentative vouée à l'échec. Les deux modèles de diarisation suivent la même réponse : ils vivent dans leurs propres dépôts avec leur propre ordre HuggingFace-d'abord, et payaient donc encore un délai de connexion chacun, l'un après l'autre, sur une machine qui avait déjà établi que le site était injoignable.

Cela ne fait jamais que réordonner deux sources qui allaient de toute façon être essayées toutes les deux, et ce réordonnancement est réversible : si la copie locale ne peut finalement pas servir le modèle, HuggingFace est tenté quand même, si bien qu'une sonde bloquée à tort par une extension coûte un échec instantané sur votre propre serveur plutôt qu'un chargement raté. Une sonde sans réponse ne change absolument rien et le chemin habituel HuggingFace-d'abord s'exécute tel quel.

Écrit avec [Claude Code](https://claude.com/claude-code).

---

## Plus de 404 fantôme pour les listes de phrases

Une instance qui sert ses propres listes de phrases peut aussi fournir une copie pré-encodée de chacune, afin que les navigateurs des visiteurs évitent le travail de tokenisation. Cette copie n'est construite que si le conteneur dispose du vocabulaire du modèle, mais l'application la demandait systématiquement et la console de chaque visiteur récoltait un 404 pour un fichier qui n'allait jamais exister. La liste des listes disponibles fait désormais autorité sur les deux points, si bien que la requête n'est émise que lorsqu'il y a quelque chose à récupérer. Rien ne change quant aux listes que vous voyez ni à la façon dont elles s'appliquent ; la console est simplement redevenue honnête, ce qui compte car une console pleine d'erreurs attendues est une console dans laquelle personne ne lit les vraies erreurs.

Rédigé avec [Claude Code](https://claude.com/claude-code).

---

## Un clic configure la dictée médicale française

Un nouveau bouton **Mode Dictée Médical** figure en haut du panneau de réglages, au-dessus de tout le reste. Un clic configure l'ensemble du poste : le modèle UltiMed, la liste de phrases médicales françaises à ses réglages par défaut, des segments de 30 secondes au lieu de 60, l'affichage dictée, la copie automatique dans le presse-papiers, une interface en français, et la précision d'encodeur adaptée à chaque moteur (int8 sur le processeur, fp32 sur le GPU, pour que le choix soit déjà le bon quel que soit celui sur lequel la machine atterrira).

La copie automatique est le seul réglage que le préréglage active au lieu de le réinitialiser. Il est désactivé d'origine car le presse-papiers système est lisible par d'autres applications et extensions ; sur un poste dont tout le flux de travail consiste à dicter puis coller dans un dossier, ce coût rachète un clic à chaque énoncé. Il reste une case à cocher ordinaire dans la section Général.

Le même préréglage est accessible par lien : `?mode=med` fonctionne, ainsi que `medecin`, `médecin`, `medical`, `doc`, `doctor` et `ultimed`, quelle que soit la casse et avec ou sans accent, car ce paramètre existe pour des adresses que les gens tapent de mémoire ou se dictent entre eux. Une valeur `?mode=` qui n'en fait pas partie signifie « pas d'avis » et ne change rien, ce qui compte car ce préréglage, contrairement à `?model=`, est enregistré : un lien nommé « mode médical » est une instruction de configuration, donc la machine reste configurée après un simple rechargement. Chaque réglage qu'il touche reste un contrôle ordinaire, modifiable ensuite.

Dans ce mode, la mesure processeur-ou-GPU se lance aussi au chargement de la page, au lieu d'attendre le clic sur Charger le modèle : le moteur est donc tranché avant que vous ne touchiez à quoi que ce soit. Elle mesure même une machine dont le moteur avait été choisi à la main, contrairement à la mesure qui se lance lors d'un chargement de page ordinaire : demander le mode médical, c'est demander le poste entier, et le même préréglage remplace déjà le modèle, la fenêtre, l'affichage, la langue de l'interface et les deux précisions d'encodeur, autant de choses que vous pouviez tout aussi bien avoir réglées vous-même. Elle ne fait toujours rien sur une machine sans GPU, et ne mesure toujours une machine donnée qu'une seule fois.

Le préréglage se dégrade au lieu d'échouer. Une instance qui ne propose pas le modèle UltiMed, ou qui ne sert pas la liste médicale française, applique tout le reste et indique en console l'élément ignoré, car un lexique médical sur le modèle générique reste bien plus proche de ce qui était demandé qu'un refus pur et simple.

Rédigé avec [Claude Code](https://claude.com/claude-code).

---

## Un modèle de diarisation auto-hébergé est trouvé là où il a été mis

Les deux modèles de diarisation sont désignés dans la configuration de l'instance par un nom de fichier, et ce nom est cherché à l'intérieur du dépôt indiqué juste à côté. Écrit sous forme de chemin complet (`/fallback_models/csukuangfj/.../model.onnx`), il était accolé tel quel au préfixe du dépôt : la requête ne pouvait que tomber à côté.

Rien n'échouait bruyamment. Un chemin qu'un miroir ne reconnaît pas reçoit en réponse la page de l'application elle-même plutôt qu'un refus, si bien que l'échec se lisait comme « ce miroir ne contient pas les modèles de diarisation » et que le téléchargement repartait discrètement vers HuggingFace. Sur un réseau qui bloque HuggingFace, ce qui est précisément la raison d'auto-héberger ces fichiers, la fonction locuteurs cessait tout simplement de fonctionner, et le fichier de configuration affichait quelque chose qui semblait parfaitement correct.

Le réglage extrait désormais le nom de fichier de ce qui a été écrit : un chemin, un chemin Windows ou une espace en trop mènent tous au fichier voulu, et une valeur qui ne nomme aucun fichier retombe sur la valeur par défaut au lieu de demander un dossier.

Rédigé avec [Claude Code](https://claude.com/claude-code).
