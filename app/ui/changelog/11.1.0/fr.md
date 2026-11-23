# 11.1.0 (2026-09-09)

## Les nombres dictés en toutes lettres s'écrivent en chiffres

Dites « vingt-cinq milligrammes » et la transcription affiche « 25 milligrammes ». La conversion couvre les nombres cardinaux en français et en anglais, y compris les composés que le français forme par juxtaposition (« quatre-vingt-dix-sept »), que le modèle les écrive avec ou sans traits d'union. Elle est activée par défaut, avec une case à décocher dans les paramètres, et s'applique aussi aux horodatages de mots : la vue par locuteur et la vue brute affichent donc toujours les mêmes chiffres.

Les décimaux sont inclus, avec un point dans les deux langues : « un virgule trente » donne « 1.30 », « one point five » donne « 1.5 », et la partie après le séparateur est lue groupe par groupe, si bien que « deux virgule zéro cinq » donne 2.05 et non 2.5. Le séparateur ne compte comme tel qu'entre deux nombres : une « virgule » dictée comme ponctuation reste un mot.

Elle est volontairement littérale plutôt qu'astucieuse, car c'est en devinant le sens que ce genre de fonction abîme une transcription. Une suite de mots-nombres n'est convertie que si elle forme un seul nombre grammatical : « deux deux » reste « 2 2 » au lieu de devenir discrètement 4. Les mots qui ne sont des nombres qu'une fois sur deux ne sont jamais convertis seuls : « un » et « une » en français, « one » en anglais, restent tels quels sauf s'ils font partie d'un nombre. C'est ainsi que « un chat » survit, alors que « vingt et un » devient 21 et « un virgule trente » devient 1.30. Les ordinaux ne sont pas touchés du tout.

Le cas à connaître est celui des années. « Dix-neuf quatre-vingt-quatre » forme deux nombres qui ne peuvent pas se combiner, et donne donc « 19 84 ». Y lire une année demande une compréhension de la phrase que la conversion n'a pas, et dicter des années est une bonne raison de désactiver l'option.

## Le bouton copier est là où vous lisez

Le bouton Copier de chaque transcription vivait dans le menu ⋮, à un clic du texte qu'il copie. Il est désormais aligné avec les boutons de vue (Brut, Dictée, Locuteurs) et copie l'entrée exactement telle que ces boutons l'affichent, étiquettes de locuteur et nettoyage de dictée compris. Le menu conserve « Copier la dictée », qui copie quelque chose que les boutons ne peuvent pas montrer : le texte nettoyé alors que l'entrée est affichée en brut.

## Les téléphones et tablettes sont prévenus que c'est une application de bureau

L'application télécharge plusieurs centaines de mégaoctets de poids et fait tourner le modèle sur l'appareil lui-même. Un téléphone a rarement la mémoire ni la vitesse soutenue nécessaires, et un navigateur mobile suspend un onglet passé en arrière-plan, ce qui interrompt une transcription en cours. Les visiteurs sur téléphone ou tablette reçoivent maintenant cet avertissement avant tout téléchargement, plutôt que de le découvrir en cours de route.

Ces mêmes appareils reçoivent une seconde explication sur le micro téléphone, car la fonction n'y a pas de sens : elle existe pour donner un microphone à un ordinateur qui n'en a pas, en l'appairant à un second appareil. Qui tient déjà un téléphone devrait utiliser le bouton Enregistrer, et la fenêtre le dit avant d'appairer quoi que ce soit.

## Corrigé : les raccourcis clavier n'avalent plus ceux du navigateur

Les raccourcis optionnels à une touche ignoraient les modificateurs : une fois activés, Ctrl+R, Ctrl+S, Ctrl+F et Cmd+R étaient interceptés, si bien que recharger, enregistrer et rechercher ne fonctionnaient plus et déclenchaient l'enregistrement ou ouvraient les paramètres à la place. Toute combinaison Ctrl, Cmd ou Alt est désormais laissée au navigateur. Une liste déroulante ayant le focus conserve elle aussi ses propres touches, là où taper une lettre fermait les paramètres au lieu de sauter à l'option correspondante.

La liste des raccourcis dans les paramètres se trompait dans l'autre sens : elle annonçait un « L » pour charger le modèle, remplacé depuis un moment par Espace et Entrée, et ne mentionnait jamais le « P » qui met l'enregistrement en pause. Elle liste maintenant exactement ce que l'application fait.
