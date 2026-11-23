# 11.3.0 (2026-09-10)

## L'encodeur fp32 ne se retélécharge plus intégralement à chaque fois

L'encodeur pleine précision pèse environ 2,4 Go, livré en deux fichiers, et jusqu'ici chaque chargement de page les retéléchargeait entièrement. Rien n'était conservé, car trois tentatives de conservation avaient échoué chacune d'une manière qui ressemblait à un problème différent : un gros enregistrement par fichier, puis une limite de taille qui excluait en fait les deux fichiers, puis de nombreux petits enregistrements.

C'était un seul et même problème. Un navigateur accepte bien plus de 2,4 Go dans son stockage, les déclare stockés, puis refuse de les relire dès que ce qu'il détient dépasse environ 2,1 Go. Mesuré ici : 2,42 Go écrits en 72 enregistrements de 32 Mo étaient annoncés comme 2,42 Go sur un quota de 10,74 Go, et après un rechargement les 63 premiers enregistrements se lisaient tandis que les 9 derniers levaient une erreur. 63 enregistrements de 32 Mo font 2 147 483 648 octets, soit 2 puissance 31, et la taille des enregistrements ne change rien à l'endroit où la limite tombe.

Le fichier ne peut donc pas être conservé, mais une partie si. Un chargement conserve désormais 1,5 Go de l'ensemble et ne demande au serveur que le reste, en reprenant à partir de la portion en cache exactement comme le faisait déjà un téléchargement interrompu en cours de route. Sur les deux fichiers que fournit le dépôt du modèle, cela signifie que le premier (1,48 Go) sort du stockage et que le second (952 Mo) passe par le réseau. Mesuré de bout en bout dans un navigateur : 2454 Mo transférés au premier chargement, 952 Mo à chacun des suivants.

Relire 1,5 Go depuis le stockage du navigateur a été mesuré à 344 Mo/s, soit environ 4,4 secondes. C'est un peu plus lent que de retélécharger les mêmes octets depuis un serveur situé sur la même machine, et bien plus rapide que n'importe quelle connexion réelle, ce qui est le cas visé.

fp16 (1,2 Go) n'a jamais été concerné et ne change pas : il tient sous le plafond et a toujours été mis en cache en entier.

Écrit avec Claude Code.

## La ligne d'état distingue le téléchargement du chargement

« Chargement du modèle » s'affichait pendant les trois phases d'un chargement : la consultation du cache, le téléchargement de ce qui manque, et la construction des sessions d'inférence. C'est sans conséquence pour un démarrage à chaud de quelques secondes, et inutile précisément dans le cas où cela compte. À l'époque, l'encodeur fp32 était retéléchargé intégralement à chaque chargement (l'entrée ci-dessus explique pourquoi, et y met fin), et une ligne d'état affichant « Chargement du modèle » pendant neuf minutes ne permet pas de distinguer une connexion lente d'une machine lente.

Il existe désormais une phase « Téléchargement du modèle » distincte. Elle apparaît au premier octet qui traverse réellement le réseau, et non au début du chargement : un démarrage entièrement servi par le cache ne revendique donc jamais un téléchargement qu'il n'a pas fait.

Chaque chargement écrit également une ligne de bilan dans la console du navigateur, par exemple `[Load] ready in 9m12s: fetch 9m04s (2331 MB), sessions 8.1s`. Seul le total existait auparavant, dans la colonne « Chargement » du banc d'essai, si bien qu'un chargement très long ne pouvait pas être attribué sans le relancer, alors même qu'une connexion et un pilote graphique qui compile des shaders n'ont aucun rapport. Un chargement qui n'a rien téléchargé affiche `cached`, et un chargement dont le volume est inconnu le dit au lieu d'emprunter ce mot.

Écrit avec Claude Code.

## La liste des précisions d'encodeur en dit moins, et le dit correctement

Les cinq entrées du sélecteur de précision de l'encodeur, dans la barre latérale, se décrivaient encore avec le vocabulaire de l'époque où il n'y avait que deux options, int8 ou fp32, et où « plus petit » voulait effectivement dire « plus rapide ». Avec cinq précisions dans la liste, cette lecture est devenue fausse, et les étiquettes avaient dérivé par ailleurs : fp32 s'annonçait « 2x plus lent » alors que la mesure sur la machine de référence donne environ 35 % sur la voie CPU.

Chaque étiquette a désormais la même forme courte, une taille et une caractéristique distinctive, et l'ordre est énoncé une seule fois au-dessus plutôt que réargumenté à chaque ligne : du plus petit téléchargement au plus grand, et la taille ne prédit pas la vitesse. C'est cette dernière proposition qui justifie la ligne. La plus petite entrée, w4a8, est aussi la plus lente à l'exécution et la plus faible sur les longs audios, car un encodeur de parole réutilise chaque poids sur un millier de trames : il est limité par le calcul et non par le déplacement des poids depuis la mémoire. Lisez cette colonne comme une échelle de taille de téléchargement, pas de vitesse. int8 reste la recommandation, et le dit maintenant en gras.

Écrit avec Claude Code.

## Conserver l'audio d'une transcription

Chaque entrée de l'historique contient déjà l'audio à partir duquel elle a été transcrite : c'est ce que joue le lecteur intégré et ce que « Retranscrire » réexécute. Il n'y avait simplement aucun moyen de le récupérer hors du navigateur. Le menu ⋮ de l'entrée le propose désormais, à côté des autres actions qui ont besoin de cet audio, et disparaît sur les entrées restaurées après un rechargement pour la même raison qu'elles : l'audio ne vit que dans l'onglet, jamais sur le disque.

Ce que vous obtenez est le WAV mono 16 kHz que le modèle a réellement entendu, pas le fichier que vous avez envoyé : `notes.mp3` est donc enregistré en `notes.wav`. C'est la copie utile quand on veut entendre ce que le modèle a entendu, ou fournir le même audio ailleurs, et le menu le dit avant le clic.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).

---

## Un lien de dictée ne fige plus la page pendant son ouverture

Ouvrir l'application avec le lien de dictée médicale endormait toute la page un instant, et la première chose sur laquelle on clique (le panneau des réglages) ne faisait rien tant qu'elle ne s'était pas réveillée. Sur un téléphone, cela durait assez longtemps pour donner l'impression d'une panne.

Le lexique médical compte 77 000 expressions, et les déploiements qui le pré-encodent livrent un fichier compagnon de 37 Mo pour qu'aucun navigateur de visiteur n'ait à refaire ce travail. C'est la lecture de ce fichier qui figeait la page : elle était effectuée sur le fil d'exécution même qui dessine la page et répond aux clics. Elle se fait désormais sur un fil d'arrière-plan, là où le reste du travail sur la liste d'expressions se faisait déjà.

Mesuré sur le vrai lexique, sur une machine ralentie six fois pour tenir lieu de téléphone : le blocage le plus long est passé de 2,7 secondes à 0,2, et le temps total pendant lequel la page était incapable de répondre à un clic durant les vingt premières secondes est passé de 3,3 secondes à 0,8.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).

---

## Le bouton d'envoi tient sur une ligne en français

« Envoyer un fichier audio » était plus large que la place que se partagent les trois boutons de capture : en français, lui seul passait à la ligne et rendait la rangée plus haute que nécessaire. L'icône de dossier dit déjà « fichier », le libellé est donc simplement « Fichier audio », et le verbe abandonné est passé dans l'infobulle.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).
