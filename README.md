# PillBox

Application Android d'aide à la préparation d'un pilulier hebdomadaire.

[Découvrir l'application](https://perrinelv.github.io/PillBox-landing/) · [Télécharger la dernière version Android](https://github.com/PerrineLV/PillBox/releases/latest/download/pillbox-latest.apk)

## Pourquoi ce projet ?

PillBox est né d'un besoin personnel : rendre la préparation d'un pilulier plus simple, centraliser le suivi des ordonnances et limiter les erreurs de boîte, de lot ou de date de péremption.

Mon expérience passée comme préparatrice en pharmacie m'a permis d'identifier les points de vigilance métier. L'application reste toutefois un outil d'organisation : elle ne détermine jamais une posologie et ne fournit aucun conseil médical.

## Périmètre fonctionnel

- Recherche dans la Base de données publique des médicaments
- Gestion des traitements et des posologies
- Saisie et consultation des ordonnances
- Rattachement des traitements couverts à chaque ordonnance
- Suivi des ordonnances actives, expirées ou remplacées
- Gestion des délivrances complètes ou fractionnées
- Alertes de renouvellement en pharmacie et d'expiration d'ordonnance
- Scan du DataMatrix des boîtes ou ajout manuel depuis le référentiel
- Identification du médicament, du lot et de la date de péremption
- Suivi des stocks par boîte et par lot
- Calcul du contenu d'un pilulier sur sept jours
- Assistant de remplissage médicament par médicament
- Vérification de la boîte utilisée pendant la préparation
- Décrémentation automatique des stocks après validation
- Historique des préparations et des lots utilisés
- Rappel hebdomadaire local
- Alertes de stock faible et de péremption

## Suivi des ordonnances

Les ordonnances sont enregistrées sous forme de données structurées : libellé, date d'émission, date de fin de validité et traitements couverts.

Pour chaque traitement, PillBox peut mémoriser :

- une quantité exprimée en durée ou en nombre de boîtes
- une délivrance complète ou fractionnée
- la périodicité d'une délivrance fractionnée
- la dernière délivrance et la date théorique de renouvellement

L'application distingue les ordonnances actives, expirées et remplacées. Une ordonnance utilisée reste consultable dans l'historique. Lorsqu'une nouvelle ordonnance couvre un traitement déjà associé à une ordonnance active, son remplacement nécessite une confirmation explicite.

Les informations enregistrées alimentent deux types d'alertes : le renouvellement de délivrance auprès de la pharmacie et l'expiration de l'ordonnance lorsqu'une nouvelle prescription doit être obtenue.

PillBox ne photographie, ne téléverse et ne lit pas automatiquement les ordonnances. Il n'utilise ni OCR ni interprétation automatisée : les informations sont saisies manuellement et restent stockées localement dans SQLite.

## Choix techniques

| Domaine | Technologies |
| --- | --- |
| Application | React Native, Expo, TypeScript, Expo Router |
| Données locales | SQLite |
| Scan | Expo Camera |
| Notifications | Expo Notifications |
| Tests | Jest |
| Qualité et livraison | ESLint, Prettier, TypeScript, GitHub Actions |

PillBox suit une approche **local-first** : les données personnelles de traitement restent sur le téléphone et aucun serveur applicatif n'est nécessaire.

## Principes de sécurité

L'application ne doit jamais :

- déterminer ou recommander une posologie
- remplacer une ordonnance
- fournir un conseil médical
- supposer qu'un médicament est équivalent à un autre
- inventer une information absente du DataMatrix ou du référentiel
- lire, interpréter ou compléter automatiquement une ordonnance

En cas d'incertitude, PillBox demande une confirmation ou refuse l'automatisation.

## Règles métier importantes

Le besoin en médicaments est calculé sur les sept jours du prochain pilulier. Les lots périmés sont exclus du stock utilisable. Les alertes distinguent le stock insuffisant, le stock proche du besoin et les lots proches de leur date de péremption.

Une préparation en cours peut être annulée sans modifier le stock. La décrémentation n'a lieu qu'après validation de la préparation.

Les dates de renouvellement issues d'une ordonnance sont des échéances de suivi. Elles ne déclenchent jamais une modification automatique du traitement ou de la posologie.

## Développement

Installer les dépendances :

```bash
npm ci
```

Lancer l'application :

```bash
npx expo start
```

Exécuter les vérifications :

```bash
npx expo install --check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build:android:check
```

## CI et publication Android

À chaque push sur `dev` et à chaque pull request, la CI vérifie :

- la compatibilité des dépendances Expo
- le formatage
- le lint
- le typage TypeScript
- les tests unitaires
- la génération du bundle Android

Un push sur `main` relance les contrôles, construit un APK Android signé et le publie dans une GitHub Release. Le nom stable de l'asset permet de conserver un lien de téléchargement permanent.

La procédure complète est décrite dans [`docs/RELEASE.md`](docs/RELEASE.md).

## Référentiel des médicaments

PillBox utilise la Base de données publique des médicaments française comme référentiel.

- Le code CIS identifie une spécialité pharmaceutique
- Le code CIP13 identifie une présentation commercialisée
- Les données personnelles de l'utilisateur sont stockées séparément du référentiel national

## Documentation

- `PROJECT.md` décrit le produit, les règles métier et le périmètre
- `AGENTS.md` contient les règles suivies par les agents de développement utilisés sur le projet
- [`docs/RELEASE.md`](docs/RELEASE.md) décrit la publication de l'APK signé
- [`docs/`](docs/) rassemble les autres notes techniques et scénarios de test

## Avertissement

PillBox est un outil personnel d'aide à l'organisation. L'application ne constitue pas un dispositif de diagnostic ou de conseil médical et ne remplace pas les recommandations d'un médecin ou d'un pharmacien.
