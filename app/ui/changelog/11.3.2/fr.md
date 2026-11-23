# 11.3.2 (2026-09-11)

## Une carte graphique télécharge désormais deux fois moins par défaut

Un visiteur dont la machine est orientée vers sa carte graphique recevait jusqu'ici l'encodeur en pleine précision, environ 2,4 Go, livré en morceaux parce qu'aucun fichier de cette taille ne peut être conservé d'un bloc. L'encodeur en demi-précision pèse environ 1,2 Go, arrive en un seul fichier, et lui est quasiment équivalent en qualité. Il existe dans les dépôts de modèles précisément pour servir, et c'est désormais ce qu'un visiteur obtient avant d'avoir choisi quoi que ce soit.

Deux choses peuvent l'écarter, et aucune ne se rabat désormais sur l'encodeur pleine précision : un adaptateur graphique qui n'annonce pas la fonctionnalité de nuanceur en demi-précision (la plupart ne l'annoncent pas, y compris celui sur lequel ce projet est développé), et un serveur de modèles qui n'héberge pas le fichier. Dans les deux cas le visiteur passe sur le moteur processeur en int8, soit 900 Mo à télécharger plutôt que 2,4 Go, et c'est la seule substitution que l'application s'autorise à faire à la place de quelqu'un. Aucune des deux ne coute un chargement raté, car toutes deux sont connues avant le moindre octet de poids, et aucune ne réécrit la préférence : le même navigateur, sur une machine capable de l'exécuter, retrouve sa carte graphique.

Rien ne change sur le moteur processeur, qui reste en int8 : la demi-précision n'y dispose d'aucun noyau utilisable et est redéployée en pleine précision à la construction du modèle, ce qui couterait de la mémoire sans rien apporter.

Écrit avec Claude Code.

## Un seul repli, et un message clair quand il n'en reste plus

L'application ne substitue plus qu'une seule chose d'elle-même : le moteur processeur en int8. L'encodeur pleine précision (environ 2,4 Go) et celui en 4 bits ne sont chargés que si vous les demandez à la main. Rien ne va les chercher à votre place, parce que l'un triple presque un téléchargement que personne n'a demandé et que l'autre est le plus faible des encodeurs sur les longs enregistrements, et qu'aucun des deux n'est une décision à prendre pour quelqu'un qui n'a rien choisi.

Conséquence : changer de moteur est désormais permis là où ça ne l'était pas. Une carte graphique qui n'a rien à exécuter est emmenée sur le processeur plutôt que laissée sur un chargement raté, et elle le dit.

Et quand le moteur processeur en int8 ne se charge pas non plus, l'application s'arrête désormais sur une fenêtre qui couvre la page, la même qu'un téléphone reçoit, au lieu du mot « Échec » dans une ligne d'état sous une page qui a toujours l'air prête à servir. À ce stade il ne reste plus rien à changer dans les réglages : cela veut dire que le serveur de modèles vers lequel pointe cette instance n'a pas fourni l'encodeur standard. Le message le dit donc, et dit qui peut y remédier.

Écrit avec Claude Code.

## Le mode dictée médicale suit le même défaut

Le préréglage de dictée médicale imposait l'encodeur pleine précision sur une carte graphique, délibérément, à l'époque où demander celui en demi-précision pouvait faire échouer un chargement et basculer un poste sur son processeur définitivement. Aucun de ces échecs n'est plus possible : un adaptateur incapable de l'exécuter se replie avant le moindre téléchargement, et un serveur de modèles qui ne l'héberge pas est pardonné dès qu'il le fait. Le préréglage demande donc désormais le même encodeur en demi-précision que partout ailleurs, ce qui est le réglage qu'il aurait dû avoir : un poste de dictée recharge la page toute la journée, souvent sur un réseau choisi pour être verrouillé, et cela divise par deux ce qu'il récupère.

Bon à savoir si vous avez déjà changé la précision à la main sur une telle machine : un lien mode médical la remplace. C'est l'intention, pas un effet de bord. Le lien configure tout le poste, et un poste basculé à la main sur l'encodeur de 2,4 Go il y a des mois le récupérait encore à chaque visite alors que tout le reste du préréglage semblait correctement appliqué.

Écrit avec Claude Code.
