# Pillbox

Application mobile personnelle pour faciliter la préparation hebdomadaire d’un pilulier.

L’objectif est de réduire les erreurs pendant le remplissage en combinant :

* un référentiel réel de médicaments français ;
* la gestion des traitements et posologies ;
* le scan du DataMatrix des boîtes ;
* la vérification du lot et de la date de péremption ;
* le suivi des stocks ;
* un assistant de préparation du pilulier ;
* un rappel hebdomadaire local.

## Statut

🚧 Projet en cours de développement.

Le projet est développé avant tout pour un usage personnel.

## Fonctionnalités prévues

* Recherche de médicaments à partir de la Base de données publique des médicaments
* Gestion des traitements et posologies
* Scan DataMatrix des boîtes de médicaments
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

## Développement

Installer les dépendances :

```bash
npm install
```

Lancer l’application :

```bash
npx expo start
```

Vérifications :

```bash
npm run lint
npm run typecheck
npm test
```

## CI

Une CI GitHub Actions vérifie automatiquement :

* le lint ;
* le typage TypeScript ;
* les tests.

## Documentation

Les documents de cadrage du projet se trouvent à la racine :

```text
PROJECT.md
AGENTS.md
```

`PROJECT.md` décrit le produit, les règles métier et le périmètre.

`AGENTS.md` contient les règles à respecter par les agents de développement utilisés sur le projet.

## Données médicaments

Le projet prévoit d’utiliser la Base de données publique des médicaments française comme référentiel.

Les médicaments et présentations sont distingués notamment via :

* CIS : spécialité ;
* CIP13 : présentation.

Les données utilisateur sont stockées séparément du référentiel national.

## Disclaimer

Cette application est un outil personnel d’aide à l’organisation.

Elle ne constitue pas un dispositif de diagnostic ou de conseil médical et ne remplace pas les recommandations d’un médecin ou d’un pharmacien.

## Licence

À définir.
