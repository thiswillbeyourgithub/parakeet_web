# Journal des modifications

**[English](./CHANGELOG.md) | [Français](./CHANGELOG_fr.md)**

Les notes de version se trouvent dans [`app/ui/changelog/`](./app/ui/changelog/), un dossier par version contenant `en.md` et `fr.md`. L'application affiche les nouvelles dans une fenêtre au premier démarrage après une mise à jour, et l'historique complet depuis la fenêtre « À propos ».

Les notes commencent à la version 10.0.0 ; les versions antérieures ne sont consignées que dans l'historique git.

Pour rédiger les notes d'une version, créez `app/ui/changelog/<version>/en.md` et `fr.md`, commençant par `# <version> (AAAA-MM-JJ)` et utilisant des titres de section `##`. Les deux fichiers doivent avoir la même date et les mêmes titres, et la version de `app/package.json` doit avoir son dossier : `test/unit/changelog.test.mjs` vérifie les trois.

Rédigé avec l'aide de [Claude Code](https://claude.com/claude-code).
