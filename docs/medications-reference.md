# Référentiel local des médicaments

## Source et périmètre

Le snapshot est une réutilisation de la [Base de données publique des médicaments (BDPM)](https://base-donnees-publique.medicaments.gouv.fr/telechargement), diffusée librement par le ministère chargé de la Santé. La BDPM précise qu'elle est actualisée mensuellement et que le réutilisateur doit mentionner la source et les dates de mise à jour.

Deux fichiers officiels, tabulés et sans en-tête, sont utilisés :

- `CIS_bdpm.txt` : spécialités ;
- `CIS_CIP_bdpm.txt` : présentations.

Le format des colonnes est celui du document officiel `Contenu_et_format_des_fichiers_telechargeables_dans_la_BDM_v4.pdf`, accessible depuis la page de téléchargement. Le snapshot actuellement livré a été construit avec les spécialités datées du **03/08/2026** et les présentations datées du **08/08/2026**, dates affichées par la BDPM au téléchargement.

La réutilisation n'a aucun caractère officiel et ne suggère aucune reconnaissance par l'ANSM, la HAS ou l'Assurance Maladie.

## Séparation des données

`assets/medications/medications.db` est un référentiel national en lecture seule pour l'application. Au lancement de l'écran de recherche, Expo copie cet asset dans `medication-reference.db`. Le snapshot embarqué remplace cette copie à chaque ouverture de l'écran afin qu'une mise à jour applicative ne conserve pas une ancienne version.

Les données personnelles restent dans `pillbox.db`, géré par le `DatabaseProvider`. Aucune table personnelle, aucun historique et aucune recherche utilisateur ne sont écrits dans le référentiel. La recherche exécute uniquement des requêtes SQLite locales ; l'application n'effectue aucun appel réseau.

## Champs conservés

Table `specialties`, une ligne par CIS :

- `cis` ;
- `name` (dénomination du médicament, dosage inclus lorsqu'il figure dans la source) ;
- `pharmaceutical_form` ;
- `administration_routes` ;
- `authorization_status` ;
- `procedure_type` ;
- `marketing_status` ;
- `authorization_date` ;
- `bdpm_status` ;
- `european_authorization_number` ;
- `holders` ;
- `enhanced_monitoring`.

Table `presentations`, une ligne par CIP13 :

- `cip13` ;
- `cis` fourni par la source ;
- `cip7` ;
- `label` de présentation ;
- `presentation_status` ;
- `marketing_status` ;
- `marketing_declaration_date`.

Les espaces de bord sont retirés lors de l'import, mais les valeurs ne sont pas interprétées. Le libellé de présentation peut contenir un nombre de comprimés ou un volume : il reste un texte brut. Il n'existe volontairement aucune colonne de quantité de conditionnement, car une extraction générique de ce texte ne serait pas suffisamment fiable.

`medication_search` est un index FTS5 dérivé de la dénomination et de la forme. Sa copie normalisée ignore casse, accents et ponctuation. Les valeurs sources affichées ne sont pas normalisées.

`metadata` conserve la version du schéma, la source, les deux dates source, la date de génération et le nombre de présentations dont le CIS est absent du fichier des spécialités.

### Incertitude constatée dans le snapshot actuel

Les deux fichiers officiels n'ont pas la même date. Quatre présentations du fichier daté du 08/08/2026 référencent un CIS absent du fichier des spécialités daté du 03/08/2026. Elles sont conservées avec leur CIS brut et comptées dans `metadata.orphan_presentations`; aucune spécialité n'est inventée. Elles ne peuvent pas apparaître dans une recherche par spécialité tant que la source ne fournit pas la relation complète.

## Mettre à jour le snapshot

1. Ouvrir la page officielle de téléchargement et noter séparément les dates affichées pour « Fichier des spécialités » et « Fichier des présentations ».
2. Télécharger directement, sans les modifier :
   - `https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_bdpm.txt`
   - `https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_CIP_bdpm.txt`
3. Lancer depuis la racine, en remplaçant les chemins et dates :

```sh
npm run medications:import -- \
  --specialties /chemin/CIS_bdpm.txt \
  --presentations /chemin/CIS_CIP_bdpm.txt \
  --output assets/medications/medications.db \
  --specialties-source-date AAAA-MM-JJ \
  --presentations-source-date AAAA-MM-JJ
```

4. Vérifier les nombres affichés et examiner toute présentation avec CIS absent. Une valeur non nulle peut provenir du décalage de publication des deux fichiers ; elle ne doit pas être corrigée manuellement.
5. Mettre à jour dans ce document les deux dates et l'incertitude constatée.
6. Exécuter `npm run lint`, `npm run typecheck`, `npm test` et `npm run build:android:check`.
7. Sur Android, rechercher plusieurs noms avec et sans accents, plusieurs dosages et plusieurs formes, puis vérifier CIS et CIP13 face à la source officielle.

L'importeur valide le nombre de colonnes, le format numérique des CIS/CIP7/CIP13, les doublons et l'encodage. Il écrit d'abord un fichier temporaire puis remplace le snapshot uniquement après une construction réussie.

