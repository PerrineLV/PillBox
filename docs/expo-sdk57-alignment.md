# Ticket 112 — Alignement des correctifs Expo SDK 57

## Diagnostic du 12 octobre 2026

La branche locale `main` correspond à `338fdc5ddca2c69bd305fb6c5e7794d2658c2a4b`, également base de la [PR 68](https://github.com/PerrineLV/PillBox/pull/68). La PR (`f8d46fa72a01be6c499ee8e4eef0847623287cc3`) ne modifie que `package-lock.json` : quatre occurrences de `brace-expansion` et le marqueur `dev` de `fsevents`.

Le contrôle Expo en ligne échoue sur `main`. Une installation isolée des deux manifestes de la PR dans un dossier temporaire, avec `npm ci --no-audit --no-fund`, réussit puis reproduit exactement les mêmes onze écarts. Le défaut d'alignement existe donc indépendamment de la mise à jour `brace-expansion`.

Le [journal CI du 6 octobre](https://github.com/PerrineLV/PillBox/actions/runs/37536355294) signalait huit écarts. Les recommandations Expo ont évolué depuis : le contrôle du 12 octobre demande les versions suivantes, toujours dans le SDK 57.

| Paquet | Avant | Après |
| --- | --- | --- |
| expo | 57.0.25 | 57.0.28 |
| expo-camera | 57.0.5 | 57.0.6 |
| expo-constants | 57.0.19 | 57.0.21 |
| expo-crypto | 57.0.3 | 57.0.4 |
| expo-document-picker | 57.0.2 | 57.0.3 |
| expo-linking | 57.0.11 | 57.0.12 |
| expo-notifications | 57.0.21 | 57.0.22 |
| expo-router | 57.0.23 | 57.0.26 |
| expo-sharing | 57.0.22 | 57.0.23 |
| expo-sqlite | 57.0.3 | 57.0.4 |
| jest-expo | 57.0.5 | 57.0.6 |

## Périmètre du lockfile

L'alignement est issu de `expo install --fix --npm`, avec Node **20.20.0** et npm **10.8.2**. Les dépendances transitives imposées par les nouveaux paquets Expo suivent leurs nouvelles contraintes. Les rafraîchissements opportunistes hors de ces contraintes sont retirés, puis le lockfile est validé par npm et réinstallé intégralement. Les quatre occurrences de `brace-expansion` conservent leurs versions initiales pour laisser le correctif de sécurité dans la PR dédiée.

Le diff final contient onze mises à jour directes et dix-huit mises à jour transitives, toutes requises par l'alignement. npm recalcule également le marqueur `dev` de `fsevents`, sans changer sa version. La configuration CI, les exclusions Dependabot, React et React Native sont conservés. Aucun changement métier ni migration SQLite n'est introduit.

## Vérifications automatisées

Résultats du 12 octobre 2026 avec Node 20.20.0 et npm 10.8.2 : installation reproductible réussie, contrôle Expo en ligne réussi (« Dependencies are up to date »), formatage, lint et typage réussis, **105 suites / 869 tests réussis**, export Android réussi (1 507 modules). L'export valide le bundle JavaScript ; il ne remplace pas une compilation d'APK ni les essais natifs sur téléphone.

Commandes de vérification :

```bash
npm ci --no-audit --no-fund
CI=1 EXPO_NO_TELEMETRY=1 npx expo install --check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build:android:check
```

Le contrôle Expo doit disposer du réseau : le repli sur la table locale `bundledNativeModules.json` peut annoncer un succès hors ligne alors que la CI échoue avec les recommandations publiées. Ce repli ne constitue pas une validation de l'alignement courant.

## Essai Android restant à réaliser

Installer un nouvel APK sur le téléphone cible en conservant les données existantes, sans désinstaller l'application : une simple actualisation JavaScript ne vérifie pas les correctifs natifs.

- Lancer PillBox et vérifier les traitements, boîtes et historiques déjà présents, puis fermer et rouvrir pour contrôler la persistance SQLite.
- Naviguer entre les écrans et revenir en arrière.
- Ouvrir la caméra et scanner une boîte connue ; vérifier l'identification affichée.
- Programmer et recevoir les rappels locaux ; vérifier l'ouverture depuis une notification et les actions de prise sur des données de test.
- Ouvrir le sélecteur de fichier puis annuler sans restaurer ; vérifier également l'export et la feuille de partage d'une sauvegarde.

Ces essais physiques ne sont pas couverts par Jest ni par l'export Metro.

## Reprise de la PR 68 par l'utilisatrice

1. Relire les modifications non commitées et intégrer la correction selon le flux `dev` vers `main`.
2. Une fois la correction dans `main`, demander le rebase de la PR 68 avec le commentaire `@dependabot rebase`.
3. Relire le nouveau diff et attendre la réussite de toute la CI, y compris le contrôle Expo et l'export Android, avant de fusionner.
4. Répercuter ensuite la mise à jour sur `dev`.

Aucun commit, push, commentaire GitHub ni merge n'est effectué dans ce ticket. La réussite future de la CI de la PR après rebase reste à vérifier.
