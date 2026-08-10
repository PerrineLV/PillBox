# PillBox

Application mobile personnelle pour faciliter la préparation hebdomadaire d’un pilulier.

L’objectif est de réduire les erreurs pendant le remplissage en combinant :

* un référentiel réel de médicaments français ;
* la gestion des traitements et posologies ;
* le scan du DataMatrix des boîtes, ou leur ajout manuel lorsqu’il est absent ou illisible ;
* la vérification du lot et de la date de péremption ;
* le suivi des stocks ;
* un assistant de préparation du pilulier ;
* un rappel hebdomadaire local.

## Statut

🚧 Projet en cours de développement.

Le projet est développé avant tout pour un usage personnel.

## Télécharger l’application

[Télécharger la dernière version Android de PillBox](https://github.com/PerrineLV/PillBox/releases/latest/download/pillbox-latest.apk)

Lors de l’installation, Android peut demander d’autoriser l’installation d’applications
provenant du navigateur ou de GitHub.

PillBox vérifie discrètement, au lancement et au retour au premier plan, si une version
plus récente a été publiée. Le cas échéant, l’accueil affiche une carte proposant
« Télécharger » et « Plus tard ». Cette information ne bloque jamais l’application : hors
ligne ou en cas de panne de GitHub, elle n’apparaît simplement pas. Le téléchargement et
l’installation restent des actions explicites : PillBox ouvre le lien GitHub dans le
navigateur et n’installe jamais rien elle-même. La version installée est rappelée en bas
de l’onglet « Plus ».

## Fonctionnalités prévues

* Recherche de médicaments à partir de la Base de données publique des médicaments
* Gestion des traitements et posologies
* Scan DataMatrix des boîtes de médicaments, ou ajout manuel depuis le référentiel
* Identification du produit, du lot et de la péremption
* Suivi du stock par boîte et par lot
* Calcul automatique du contenu d’un pilulier sur 7 jours
* Assistance au remplissage médicament par médicament
* Vérification de la boîte utilisée pendant la préparation
* Décrémentation automatique des stocks
* Historique des préparations et des lots utilisés
* Notification locale hebdomadaire pour penser à préparer le pilulier
* Alertes de stock faible et de péremption

## Stack

* React Native
* Expo
* TypeScript
* Expo Router
* SQLite
* Expo Camera
* Notifications locales Expo

Le projet suit une approche **local-first** : les données personnelles de traitement sont destinées à rester sur le téléphone.

## Principes

L’application ne doit jamais :

* déterminer ou recommander une posologie ;
* remplacer une ordonnance ;
* fournir un conseil médical ;
* supposer qu’un médicament est équivalent à un autre ;
* inventer une information absente du DataMatrix ou du référentiel.

En cas d’incertitude, l’application doit demander confirmation ou refuser l’automatisation.

## Règles des alertes de stock

L’accueil calcule le besoin exact des traitements inclus dans le prochain pilulier,
sur les sept jours commençant le lendemain. Le stock est « proche du besoin » lorsqu’il
est suffisant mais ne dépasse pas le besoin de plus de 25 %. Ce pourcentage est défini
par `LOW_STOCK_MARGIN_PERCENT`.

Un lot non vide est signalé comme proche de sa péremption pendant les 30 jours civils
qui la précèdent, date du jour comprise. Cette fenêtre est définie par
`EXPIRATION_WARNING_DAYS`. Un lot déjà périmé n’apparaît pas dans cette alerte et reste
toujours exclu du stock utilisable.

## Développement

Installer les dépendances :

```bash
npm ci
```

Lancer l’application :

```bash
npx expo start
```

Vérifications :

```bash
npx expo install --check
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build:android:check
```

## CI et release

La CI vérifie le formatage, le lint, le typage, les tests et le bundle Android à chaque
push sur `dev` et à chaque pull request
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

Un push sur `main` déclenche en plus la release : les contrôles sont rejoués, un APK
Android signé est construit, puis publié dans une GitHub Release dont l’asset garde
toujours le même nom — c’est ce qui rend permanent le lien de téléchargement ci-dessus.
La version publiée est composée automatiquement à partir de `app.json` et du numéro de
run. → voir [docs/RELEASE.md](docs/RELEASE.md) pour la procédure complète.

## Documentation

* `PROJECT.md` décrit le produit, les règles métier et le périmètre.
* `AGENTS.md` contient les règles à respecter par les agents de développement utilisés
  sur le projet.
* [`docs/RELEASE.md`](docs/RELEASE.md) documente la convention de version, la CI, la
  publication de l’APK Android signé et les réglages de sécurité GitHub.
* [`docs/`](docs/) rassemble les autres notes techniques, dont les scénarios de test des
  rappels locaux sur téléphone.

## Données médicaments

Le projet prévoit d’utiliser la Base de Données Publique des Médicaments française comme référentiel.

Les médicaments et présentations sont distingués notamment via :

* CIS : spécialité ;
* CIP13 : présentation.

Les données utilisateur sont stockées séparément du référentiel national.

## Disclaimer

Cette application est un outil personnel d’aide à l’organisation.

Elle ne constitue pas un dispositif de diagnostic ou de conseil médical et ne remplace pas les recommandations d’un médecin ou d’un pharmacien.