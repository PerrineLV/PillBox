# Référentiel local des médicaments

## Source et périmètre

Le snapshot est une réutilisation de la [Base de données publique des médicaments (BDPM)](https://base-donnees-publique.medicaments.gouv.fr/telechargement), diffusée librement par le ministère chargé de la Santé. La BDPM précise qu'elle est actualisée mensuellement et que le réutilisateur doit mentionner la source et les dates de mise à jour.

Trois fichiers officiels, tabulés et sans en-tête, sont utilisés :

- `CIS_bdpm.txt` : spécialités ;
- `CIS_CIP_bdpm.txt` : présentations ;
- `CIS_GENER_bdpm.txt` : groupes génériques.

Le format des colonnes est celui du document officiel `Contenu_et_format_des_fichiers_telechargeables_dans_la_BDM_v4.pdf`, accessible depuis la page de téléchargement — à l'exception du fichier des groupes génériques, dont le format réellement observé (5 colonnes tabulées : identifiant de groupe, libellé, CIS, type, numéro de tri) diverge de celui d'un export communautaire plus ancien qui comportait une 6e colonne vide ; seul le format du fichier officiel actuel fait foi. Le snapshot actuellement livré (`assets/medications/medications.db`) a été construit avec les spécialités et les groupes génériques datés du **03/08/2026** et les présentations datées du **10/08/2026**, dates affichées par la BDPM au téléchargement.

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

Table `generic_groups`, une ligne par couple (groupe générique, CIS membre) — un même CIS peut légitimement apparaître dans plusieurs groupes (ex. complémentarité posologique entre dosages) :

- `group_id` (identifiant du groupe générique) ;
- `cis` fourni par la source ;
- `group_label` (libellé du groupe générique) ;
- `type` (code brut du fichier source, non interprété par l'importeur) ;
- `sort_number` (numéro de tri de la présentation au sein du groupe).

La clé primaire est le couple `(group_id, cis)` : un même CIS peut légitimement porter deux lignes de `type` différent dans deux groupes distincts (ex. complémentarité posologique entre un dosage à 250 mg et un dosage à 500 mg). Le code `type` n'est jamais interprété ni traduit par l'importeur : il reste la valeur brute du fichier source, conformément à l'interdiction de déduire une correspondance générique par un autre moyen que la relation officielle. D'après la documentation ANSM du format des fichiers téléchargeables, les valeurs observées sont `0` (princeps), `1` (générique), `2` (générique par complémentarité posologique) et `4` (générique substituable) ; cette liste est indicative et ne conditionne aucune logique de l'importeur.

Cette table est lue en lecture seule par une section informative optionnelle (recherche médicament, détail d'un traitement, détail d'une boîte) qui liste les autres membres du groupe générique d'une spécialité, à titre indicatif uniquement (voir `src/components/medications/generic-group-section.tsx` pour l'affichage et `src/domain/medications/generic-group-display.ts` pour le filtrage/regroupement). Un membre dont le CIS est absent de `specialties` n'a pas de nom affichable : il n'est pas montré à l'utilisatrice (voir incertitude ci-dessous), mais reste compté et documenté côté import — rien n'est masqué à la source, seul l'affichage final filtre ce qui n'est pas exploitable. Cette table n'intervient dans aucune règle de stock, de boîte ou de préparation, et ne déclenche ni ne suggère aucun remplacement.

`metadata` conserve la version du schéma, la source, les trois dates source, la date de génération, le nombre de présentations dont le CIS est absent du fichier des spécialités (`orphan_presentations`) et le nombre de lignes de groupes génériques dont le CIS est absent du fichier des spécialités (`orphan_generic_groups`).

### Incertitude constatée dans le snapshot actuel

Les fichiers officiels n'ont pas tous la même date. Quatre présentations du fichier daté du 10/08/2026 référencent un CIS absent du fichier des spécialités daté du 03/08/2026. Elles sont conservées avec leur CIS brut et comptées dans `metadata.orphan_presentations` ; aucune spécialité n'est inventée. Elles ne peuvent pas apparaître dans une recherche par spécialité tant que la source ne fournit pas la relation complète.

Le fichier des groupes génériques référence un nombre nettement plus important de CIS absents du fichier des spécialités : **2513 lignes sur 10719** (`metadata.orphan_generic_groups`), soit environ 2500 CIS distincts. Contrairement au décalage entre présentations et spécialités (quelques jours de publication), cet écart n'est pas expliqué par une différence de date puisque les deux fichiers sont datés du même jour (03/08/2026). Il s'agit vraisemblablement de spécialités retirées ou historiques, encore référencées dans le regroupement générique mais qui ne figurent plus dans le fichier courant des spécialités actives. Ces lignes sont conservées telles quelles en base (CIS brut, aucune spécialité inventée, rien n'est supprimé de `generic_groups`) : la couche import/requête (`getGenericGroupMembers`) les retourne toujours, avec un nom `null`. Seule la section d'affichage informatif (ticket 23) choisit de ne pas montrer un membre sans nom résolu, jugé plus source de confusion que d'information pour l'utilisatrice ; si tous les membres d'un groupe sont dans ce cas, la section n'apparaît pas du tout pour cette spécialité.

## Mettre à jour le snapshot

1. Ouvrir la page officielle de téléchargement et noter séparément les trois dates affichées : « Fichier des spécialités », « Fichier des présentations » et « Fichier des groupes génériques ».
2. Télécharger directement, sans les modifier :
   - `https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_bdpm.txt`
   - `https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_CIP_bdpm.txt`
   - `https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_GENER_bdpm.txt`
3. Lancer depuis la racine, en remplaçant les chemins et dates :

```sh
npm run medications:import -- \
  --specialties /chemin/CIS_bdpm.txt \
  --presentations /chemin/CIS_CIP_bdpm.txt \
  --generics /chemin/CIS_GENER_bdpm.txt \
  --output assets/medications/medications.db \
  --specialties-source-date AAAA-MM-JJ \
  --presentations-source-date AAAA-MM-JJ \
  --generics-source-date AAAA-MM-JJ
```

4. Vérifier les nombres affichés et examiner toute présentation ou ligne de groupe générique avec CIS absent. Une valeur non nulle peut provenir du décalage de publication entre fichiers ; elle ne doit pas être corrigée manuellement.
5. Mettre à jour dans ce document les trois dates et l'incertitude constatée.
6. Exécuter `npm run lint`, `npm run typecheck`, `npm test` et `npm run build:android:check`.
7. Sur Android, rechercher plusieurs noms avec et sans accents, plusieurs dosages et plusieurs formes, puis vérifier CIS et CIP13 face à la source officielle.

L'importeur valide le nombre de colonnes, le format numérique des CIS/CIP7/CIP13, les doublons et l'encodage. Il écrit d'abord un fichier temporaire puis remplace le snapshot uniquement après une construction réussie.

