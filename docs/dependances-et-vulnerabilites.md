# Dépendances et alertes de vulnérabilité

Ce document conserve le tri des alertes Dependabot ouvertes et les faits vérifiés qui l'appuient, pour qu'une relecture ultérieure reparte de constats et non d'une reconstitution.

Analyse du 3 septembre 2026, sur `expo@54.0.37`.

## Posture

Les versions d'Expo, de React, de React Native et des modules natifs sont imposées par le SDK, pas choisies dépendance par dépendance. `.github/dependabot.yml` les exclut donc des montées de version : elles n'évoluent que par un ticket de migration de SDK, avec les versions rendues par `expo install` et un essai sur le téléphone Android cible. La CI exécute `npx expo install --check` pour détecter tout écart.

Ces exclusions portent toutes un `update-types`, ce qui les limite aux **montées de version**. Les **correctifs de sécurité** restent proposés, et sont évalués par GitHub sur la branche par défaut (`main`), pas sur `dev`.

## Le tri

Huit alertes ouvertes, aucune critique. Sept portent sur la chaîne de compilation et ne sont jamais embarquées dans l'APK ; une seule s'exécute réellement dans l'application.

| Alerte | Paquet | Gravité | Chemin | Dans l'APK ? |
| --- | --- | --- | --- | --- |
| #1, #3, #4, #5 | `postcss` | 3 hautes, 1 modérée | `expo` → `@expo/metro-config` | non |
| #6, #7 | `image-size` | 2 hautes | `expo` → `metro` | non |
| #2 | `uuid` | modérée | `@expo/config-plugins` → `xcode` | non |
| #8 | `decode-uri-component` | modérée | `expo-router` → `query-string` | **oui** |

### Motifs de rejet retenus

**PostCSS, image-size, uuid → « Vulnerable code is not actually used ».** Le motif est factuel, pas un arrangement :

- PostCSS sert au support CSS et web de Metro. Le projet ne contient **aucun fichier CSS** et ne construit pas de version web.
- Les deux failles d'`image-size` portent nommément sur les parseurs **ICNS**, **JXL** et **HEIF**. Les seuls assets image sont deux PNG et un SVG.
- `uuid` arrive par `xcode`, qui génère un projet **iOS**. Le projet est Android uniquement : ce code ne s'exécute nulle part, ni en local ni en CI.

**decode-uri-component → « Risk is tolerable to this project ».** Celle-ci s'exécute vraiment, à chaque analyse de lien profond. La tolérance se justifie sur trois points :

- l'impact est un blocage de l'application, pas une fuite de données ni une exécution de code ;
- l'exploitation suppose qu'une autre application malveillante soit installée sur le téléphone et émette une intention `pillbox://` forgée ;
- aucun correctif n'existe à aucun niveau de la chaîne, y compris dans les dernières versions publiées.

## Pourquoi rien n'est corrigeable aujourd'hui

Les plages déclarées par les parents interdisent d'atteindre les versions corrigées. Un rafraîchissement de lockfile n'y peut rien : `~` verrouille la mineure, `^` verrouille la majeure.

| Paquet | Installé | Corrigé à partir de | Plage déclarée par le parent | Atteignable ? |
| --- | --- | --- | --- | --- |
| `postcss` | 8.4.49 | 8.5.23 | `@expo/metro-config@54` → `~8.4.32` | non, bloqué sous 8.5.0 |
| `image-size` | 1.2.1 | 2.0.3 | `metro@0.83.3` → `^1.0.2` | non, bloqué sous 2.0.0 |
| `uuid` | 7.0.3 | 11.1.1 | `xcode@3.0.1` → `^7.0.3` | non, bloqué sous 8.0.0 |
| `decode-uri-component` | 0.2.2 | 0.5.0 | `query-string@7.1.3` → `^0.2.2` | non, bloqué sous 0.3.0 |

### Ce que la migration SDK 57 réglera, et ce qu'elle ne réglera pas

`npm audit` annonce `fixAvailable: expo@57.0.19` pour les trois failles de chaîne de build. **C'est vrai pour PostCSS seulement.** Vérification des plages déclarées par les versions les plus récentes :

| Parent (dernière version) | Plage déclarée | Effet |
| --- | --- | --- |
| `@expo/metro-config@57.0.12` | `postcss ^8.5.14` | atteint 8.5.23, **corrigé** |
| `metro@0.87.0` | `image-size ^1.0.2` | inchangé, toujours bloqué |
| `@expo/config-plugins@57.0.9` | `xcode ^3.0.1` → `uuid ^7.0.3` | inchangé, toujours bloqué |

Quatre alertes PostCSS tomberont donc d'elles-mêmes lors de la migration. Les trois autres y survivront et devront être réécartées.

### Le cas `decode-uri-component`

Dependabot a tenté la mise à jour de sécurité le 3 septembre 2026 et a échoué avec `security_update_not_possible`. L'échec est normal et se reproduira à chaque exécution tant que l'alerte n'est pas écartée.

Deux impasses, toutes deux vérifiées :

- **En amont.** `query-string@9.2.2`, la dernière version, dépend de `decode-uri-component@^0.4.1`, toujours dans la plage vulnérable (`<= 0.4.2`). Et `expo-router` déclare `query-string@^7.1.3` en 55, 56 **et 57** : monter en SDK ne change rien.
- **Par `overrides`.** `decode-uri-component@0.5.0`, seule version non vulnérable, est un **module ESM pur** (`"type": "module"`, aucune entrée CommonJS). `query-string@7` est en CommonJS et fait un `require()` dessus : forcer la version casserait la résolution dans Metro.

Il n'y a donc rien à faire aujourd'hui. À réexaminer lorsque `query-string` publiera une version acceptant `decode-uri-component@0.5.x`.

## À ne pas faire

**`npm audit fix --force`.** Pour `decode-uri-component`, npm propose `expo-router@5.1.11` — une **rétrogradation** depuis la version installée. Pour les autres, `expo@57`, soit trois versions majeures de SDK d'un coup. La commande ferait plus de dégâts que les failles qu'elle prétend corriger.

**Un `npm audit` bloquant en CI.** Aucune des alertes n'étant corrigeable, la CI serait rouge en permanence. La chaîne actuelle — `npm ci` strict, `expo install --check`, format, lint, typage, tests, bundle Android — couvre ce qui est vérifiable automatiquement ; Dependabot couvre le reste, de façon asynchrone.

## Comment refaire le tri

```bash
npm audit --omit=dev          # ce qui atteint les dépendances de production
npm ls <paquet> --omit=dev    # le chemin réel, sans les outils de développement
npm view <parent> dependencies.<paquet>   # la plage déclarée, donc le blocage
npm view <paquet>@<version> type exports  # CommonJS ou ESM, avant tout override
npx expo install --check      # cohérence avec le SDK installé
```

La dernière commande de la liste est celle qui compte le plus : une alerte ne se juge pas à sa gravité mais à son chemin. Un paquet de bundler et un paquet embarqué dans l'application n'appellent pas la même réponse.
