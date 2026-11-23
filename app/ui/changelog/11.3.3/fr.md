# 11.3.3 (2026-09-12)

## Le bandeau de développement expire désormais

Une instance en mode développement accueille chaque visiteur par un avertissement rouge : cette instance est en cours de modification, attendez-vous à des pannes, revenez dans quelques heures. Il indique depuis combien de temps l'instance a été redémarrée, ce qui est précisément ce qui rendait l'affirmation vérifiable.

Cette affirmation se périme. Une instance que personne n'a redémarrée depuis cinq jours n'est plus en cours de modification d'une manière dont un visiteur puisse tenir compte, et un bandeau rouge qui est simplement toujours là est un bandeau que plus personne ne lit, y compris le jour où il compte enfin. Il se retire donc de lui-même passé cinq jours de fonctionnement, et revient au redémarrage suivant.

Une instance qui n'indique pas quand elle a démarré conserve son bandeau. Ne pas savoir quand une chose a commencé ne prouve pas qu'elle a commencé il y a longtemps, et la seule configuration qui n'indique rien est le serveur de développement lui-même, là où l'avertissement se justifie le plus.

Rédigé avec Claude Code.

## Une carte graphique inutilisable n'est plus mesurée

La courte mesure qui tranche entre le processeur et la carte graphique évitait déjà les machines qu'elle ne pouvait pas aider. Les deux petits fichiers qui lui servent à mesurer, environ 5 Mo au total, étaient malgré tout téléchargés en arrière-plan, à chaque visite, y compris sur des machines où aucune mesure n'allait jamais être lancée. Ces visiteurs se retrouvaient sur le moteur processeur dans tous les cas, après l'avoir payé. Ils ne sont désormais récupérés que là où la mesure peut réellement avoir lieu.

Rédigé avec Claude Code.
