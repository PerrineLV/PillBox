# PillBox

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

À chaque push sur `dev`, GitHub Actions vérifie automatiquement :

* le lint ;
* le typage TypeScript ;
* les tests ;
* la génération du bundle Android Expo.

## APK Android release signé

Le workflow `Android release APK` se déclenche uniquement lors d’un push sur `main`.
Dans le fonctionnement attendu du dépôt, ce push est produit par la fusion d’une pull
request. Le workflow exécute le lint, le typecheck et les tests, génère le projet
Android avec Expo Prebuild, puis construit un APK release signé.

L’identifiant Android est fixé à `com.perrinelv.pillbox`. Ne pas le modifier après la
première installation : Android considérerait l’application comme une autre
application. Le `versionCode` utilise le numéro croissant du run GitHub Actions.

### Créer la clé de signature

Générer une clé dédiée dans un emplacement privé, hors du dépôt :

```bash
keytool -genkeypair -v \
  -keystore pillbox-release.jks \
  -storetype PKCS12 \
  -alias pillbox \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Conserver les mots de passe saisis. Encoder ensuite le fichier sur une seule ligne :

```bash
# Linux
base64 -w 0 pillbox-release.jks

# macOS
base64 < pillbox-release.jks | tr -d '\n'
```

Dans `Settings` → `Secrets and variables` → `Actions`, créer ces secrets GitHub :

* `ANDROID_KEYSTORE_BASE64` : résultat Base64 complet ;
* `ANDROID_KEYSTORE_PASSWORD` : mot de passe du keystore ;
* `ANDROID_KEY_ALIAS` : alias choisi, par exemple `pillbox`.

Le keystore PKCS#12 utilise le même mot de passe pour le conteneur et sa clé privée.
Le workflow applique donc `ANDROID_KEYSTORE_PASSWORD` aux deux et vérifie le fichier,
le mot de passe et l’alias avant de lancer Gradle. Le secret
`ANDROID_KEY_PASSWORD`, s’il avait déjà été créé, n’est plus utilisé et peut être
supprimé.

Le workflow échoue explicitement si un de ces secrets est absent. Le fichier `.jks`,
les mots de passe et leur représentation Base64 ne doivent jamais être commités.

### Déclencher et télécharger l’APK

1. Fusionner une pull request dans `main`. Il est recommandé de protéger `main` dans
   les règles GitHub afin d’interdire les push directs.
2. Ouvrir l’onglet `Actions`, puis le run `Android release APK` correspondant.
3. Télécharger l’artefact `pillbox-apk-<SHA>` dans la section `Artifacts`. Il est
   conservé pendant 30 jours et contient `app-release.apk`.

### Installer ou mettre à jour

Pour une première installation, autoriser si nécessaire l’installation d’applications
inconnues sur Android, puis ouvrir `app-release.apk`. Avec ADB :

```bash
adb install app-release.apk
```

Pour une mise à jour, ne pas désinstaller l’application, afin de conserver sa base
SQLite locale. Installer directement le nouvel APK ou utiliser :

```bash
adb install -r app-release.apk
```

Android accepte la mise à jour uniquement si l’identifiant d’application et la clé de
signature sont identiques et si le `versionCode` n’est pas inférieur. Un APK signé avec
une autre clé ne peut pas remplacer l’installation existante sans désinstallation et
perte des données locales de l’application.

### Sauvegarder et restaurer la capacité de signature

Conserver au moins deux sauvegardes chiffrées et indépendantes de
`pillbox-release.jks`, ainsi que l’alias et les mots de passe dans un gestionnaire de
secrets. Une copie doit être située hors du poste de développement.

Si le poste est perdu, restaurer le même fichier `.jks`, vérifier son empreinte avec
`keytool -list -v -storetype PKCS12 -keystore pillbox-release.jks`, puis recréer les
trois secrets GitHub. Une nouvelle clé, même avec le même alias, ne permet pas de
mettre à jour les installations existantes.

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
