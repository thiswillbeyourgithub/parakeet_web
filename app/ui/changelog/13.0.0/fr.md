# 13.0.0 (2026-11-23)

## Le modèle redux expérimental a été renommé

Sur le hub, `Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-experimental-onnx` (qui contenait déjà le redux UltiMed v2) devient [`Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-v2-experimental-onnx`](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-redux-UltiMed-v2-experimental-onnx). L'ancien identifiant, et le plus ancien `...-redux-UltiMed-onnx`, y mènent toujours.

## Le modèle médical est désormais UltiMed v2

Le modèle médical français est désormais UltiMed v2, [`Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v2-onnx`](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v2-onnx), le modèle dont les erreurs ont servi à tirer les règles de médicaments v2 ci-dessous. Sur le hub, le modèle précédent a été renommé `Olicorne/parakeet-tdt-0.6b-v3-ultra-UltiMed-v1-onnx`. Les anciens identifiants (`...-ultra-UltiMed-onnx` et le plus ancien `...-UltiMed-onnx`) sont toujours reconnus, et mènent à la v2 : un choix de modèle enregistré, un ancien lien `?model=` et la variable `VITE_MODEL_REPO` d'un opérateur continuent de fonctionner, et le point d'entrée journalise la substitution pour que le relais autorise le bon dépôt. `?model=ultra-ultimed` et le **Mode Dictée Médical** sélectionnent la v2 ; pour servir la v1 délibérément, indiquez son identifiant `-v1-onnx`. Un utilisateur d'UltiMed qui revient télécharge une fois les poids v2 (le cache du navigateur est indexé par identifiant de dépôt), puis les fichiers v1 sont retirés du cache.

## L'affichage « Médicaments » utilise désormais les règles UltiMed v2

Les règles de correction de l'affichage **Médicaments** viennent désormais du nouveau [dépôt de regex UltiMed v2](https://github.com/UltiMed-Org/UltiMed-ASR-FR-v2-regex-fixes) (AGPL-3.0-or-later) au lieu du dépôt du modèle v1 : 25 099 règles réparties en six fichiers, tirées des erreurs du modèle UltiMed v2 sur le corpus v2, appliquées dans l'ordre noms de médicaments (2 447), termes du dictionnaire (18 261), PARHAF (2 172), PARROT (117), acronymes (43), puis les 2 059 règles écrites à la main en dernier (la v1 les appliquait en premier). Le fichier compilé passe de 23,6 Mo à 11,1 Mo (environ 0,7 Mo tel que servi). Pour les opérateurs : `scripts/compile-drug-rules.mjs` attend désormais le dépôt de regex cloné dans `fallback_models/UltiMed-ASR-FR-v2-regex-fixes` (ou prend `--repo DIR`).

## L'affichage « Médicaments » passe à 45 110 règles

L'affichage **Médicaments** embarque désormais le jeu final de règles UltiMed v2 : 45 110 règles au lieu de 25 099, dans les mêmes six fichiers et le même ordre (noms de médicaments 4 145, termes du dictionnaire 36 177, PARHAF 2 502, PARROT 138, acronymes 47, puis les 2 101 règles écrites à la main en dernier). Les nouvelles règles sont les règles v1 réécrites dans l'orthographe v2 et les erreurs d'écoute de deux autres modèles de la famille, la quantification w4a8 d'UltiMed v2 et le fine-tune redux : elles aident surtout quand l'application fait tourner l'un de ces modèles ou rencontre un nouvel audio. Elles ne modifient toujours aucune des 602 776 étiquettes correctes du corpus v2 ni aucune des 1 662 transcriptions VoxPopuli en français, et réécrivent 67 des 100 000 phrases de presse en français (47 avant). Le fichier compilé passe de 11,1 Mo à 29,1 Mo (environ 2,0 Mo tel que servi au lieu de 0,7 Mo).

## Un aide-mémoire des « commandes de dictée », et les modèles de dictée fonctionnent enfin

Un nouveau lien **Commandes de dictée** sur l'écran principal (aussi un bouton dans la barre latérale des réglages) ouvre un tableau de ce qu'il faut dire en vue Dictée pour obtenir chaque retour à la ligne, signe de ponctuation, abréviation ou modèle, avec la formulation recommandée en gras (par exemple « nouveau tiret » pour un tiret de liste, car « tiret » seul n'est pas compris). Les formulations sont testées contre les règles réellement chargées par cette instance, donc le tableau ne liste que ce qui fonctionne ici.

Sa construction a révélé un bug : le chargeur de règles découpait le CSV ligne par ligne avant de l'analyser, si bien que les modèles « ajoute la commande ... », dont le texte tient sur plusieurs lignes, ne se déclenchaient jamais, et chaque ligne de leur texte devenait une règle parasite (59 avec les règles Murmure par défaut, dont une qui cherchait « pas de toux »). Les modèles sont désormais chargés comme des règles uniques et les 20 fonctionnent.
