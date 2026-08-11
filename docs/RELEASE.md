# Release et intégration continue

Documentation de mainteneur : convention de version, pipeline d’intégration continue,
publication de l’APK Android signé et réglages de sécurité GitHub associés. Le
[README](../README.md) n’en donne que le résumé.

## Convention de version

Une seule version circule dans tout le projet, sous la forme `MAJEUR.MINEUR.BUILD` :

| Élément | Valeur | Origine |
| --- | --- | --- |
| Ligne produit | `MAJEUR.MINEUR` | `expo.version` dans `app.json`, dont le patch reste toujours `0` |
| Build | `BUILD` | `versionCode` Android = `github.run_number` du workflow de release |
| Version Expo | `MAJEUR.MINEUR.BUILD` | composée par `app.config.ts`, devient le `versionName` Android |
| Tag GitHub Release | `v<MAJEUR.MINEUR.BUILD>` | calculé par le workflow avec `npm run app:version` |
| Asset APK | `pillbox-latest.apk` | nom stable imposé par le lien permanent du README |

Le patch d’une version publiée est donc toujours égal au `versionCode` Android, ce qui
garantit une progression strictement croissante sans intervention manuelle. Un re-run du
même workflow conserve son `run_number` : il republie le même tag pour le même commit et
reste idempotent.

Pour passer à une nouvelle ligne produit, il suffit de modifier `expo.version` dans
`app.json` (par exemple `1.1.0`) ; aucune autre version n’est à saisir ailleurs. La
commande `npm run app:version` affiche la version qui serait publiée, et le workflow
vérifie après `prebuild` que le `versionName` et le `versionCode` du projet Android
correspondent bien à cette valeur.

## CI

Le pipeline conserve trois responsabilités distinctes :

| Événement | Contrôle | Publication signée |
| --- | --- | --- |
| Push direct sur `dev` | CI complète de feedback | Non |
| Pull request vers `dev` ou `main` | CI complète avant fusion | Non |
| Push effectif sur `main` | Contrôles du SHA fusionné, build et publication | Oui |

La CI complète exécute :

* la cohérence des dépendances avec le SDK Expo (`expo install --check`) ;
* le formatage ;
* le lint ;
* le typage TypeScript ;
* les tests ;
* la génération du bundle Android Expo.

Une branche `dev` ayant déjà été contrôlée par un push peut être contrôlée une seconde
fois dans le contexte de sa pull request vers `main`. Cette redondance est volontaire :
le premier run fournit un retour de développement, le second valide le contenu proposé
à la fusion. Après fusion, la release recontrôle encore le SHA final de `main` avant
d'accéder aux secrets de signature.

Les mises à jour de version Dependabot ciblent `dev`. Une mise à jour de sécurité peut
viser directement la branche par défaut `main` et bénéficie alors de la même CI de pull
request. Aucun workflow déclenché par une pull request ne référence les secrets de
signature et aucune mise à jour Dependabot n'est fusionnée automatiquement.

Les workflows utilisent uniquement les permissions GitHub minimales : lecture du
dépôt pour les jobs de vérification et de build, puis écriture du contenu uniquement
pour le job qui crée la GitHub Release. Les actions réutilisables sont épinglées sur
des SHA de commit complets.

## APK Android release signé

Le workflow `Android release APK` se déclenche uniquement lors d’un push sur `main`.
Dans le fonctionnement attendu du dépôt, ce push est produit par la fusion d’une pull
request. Le workflow exécute le formatage, le lint, le typecheck et les tests, génère
le projet Android avec Expo Prebuild, puis construit un APK release signé. Le vrai
build Gradle tient lieu de contrôle Android final : le workflow de release ne répète
pas l'export Expo utilisé par la CI.

Les runs de release sont sérialisés sans interrompre celui qui construit ou publie
déjà. Si plusieurs pushes attendent, GitHub conserve le plus récent dans la file. Le
tag déterministe `android-<SHA complet>` permet de relancer le même workflow sans créer
une seconde release. La publication vérifie la cible du tag, compare tout asset déjà
présent octet par octet, complète uniquement un asset absent et refuse tout écrasement
ou checksum incohérent. Une ancienne relance ne peut pas remplacer une release plus
récente comme « latest » ; le lien permanent reste associé au SHA réussi le plus
récent de l'historique de `main`.

L’identifiant Android est fixé à `com.perrinelv.pillbox`. Ne pas le modifier après la
première installation : Android considérerait l’application comme une autre
application. Le `versionCode` utilise le numéro croissant du run GitHub Actions.

Une fois l’APK construit, signé et son checksum vérifié, le job `publish-to-landing`
republie `pillbox-latest.apk` et `pillbox-latest.apk.sha256` comme assets de la release
taguée `latest` du dépôt public `PerrineLV/PillBox-landing`, qui héberge la landing
page. Le dépôt `PillBox` étant privé, ses propres assets de release exigent une
authentification ; `PillBox-landing` reste donc la seule source de téléchargement
accessible sans compte. L’APK n’est jamais commité dans l’arborescence de
`PillBox-landing` : il ne vit que comme asset de release, afin de ne pas faire grossir
son historique Git d’un fichier de plusieurs dizaines de mégaoctets à chaque version. Le
tag `latest` est créé une seule fois puis mis à jour en place (assets remplacés par
`gh release upload --clobber`) à chaque run suivant, jamais supprimé puis recréé : le
lien permanent `releases/latest/download/pillbox-latest.apk` ne connaît donc aucune
interruption entre deux versions.

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

### Créer le jeton pour PillBox-landing

Le job `publish-to-landing` s’authentifie auprès de `PillBox-landing` avec le secret
`LANDING_REPO_TOKEN`, un jeton d’accès personnel *fine-grained* dédié, à portée
strictement minimale :

1. Sur le compte GitHub propriétaire des deux dépôts, ouvrir `Settings` →
   `Developer settings` → `Personal access tokens` → `Fine-grained tokens` → `Generate
   new token`.
2. Restreindre `Repository access` au seul dépôt `PillBox-landing` (jamais
   `PillBox`, ni tous les dépôts).
3. Sous `Permissions` → `Repository permissions`, accorder uniquement `Contents:
   Read and write` — c’est le seul droit nécessaire pour créer une release et y
   téléverser des assets. Laisser tous les autres droits à `No access`.
4. Choisir une expiration (ce jeton se régénère comme un secret de signature) puis
   générer le jeton.

Dans `Settings` → `Secrets and variables` → `Actions` **du dépôt `PillBox`** (jamais
dans `PillBox-landing`, qui ne doit pas détenir sa propre capacité d’écriture), créer
le secret `LANDING_REPO_TOKEN` avec la valeur du jeton généré.

À l’expiration ou en cas de rotation, régénérer un jeton avec la même portée puis
remplacer uniquement la valeur du secret `LANDING_REPO_TOKEN` : aucun autre réglage
n’est à modifier.

Le workflow échoue explicitement si un de ces secrets est absent. Le fichier `.jks`,
les mots de passe et leur représentation Base64 ne doivent jamais être commités.

### Déclencher et télécharger l’APK

1. Fusionner une pull request dans `main`. Il est recommandé de protéger `main` dans
   les règles GitHub afin d’interdire les push directs.
2. Télécharger l’APK depuis la section
   [Télécharger l’application](../README.md#télécharger-lapplication).

Chaque build réussi est aussi conservé pendant 30 jours comme artefact du run GitHub
Actions : ouvrir le run `Android release APK`, puis télécharger
`pillbox-apk-<SHA>`, qui contient `pillbox-latest.apk` et
`pillbox-latest.apk.sha256`.

### Vérifier le téléchargement

Télécharger l’APK et son fichier de checksum depuis la même GitHub Release, les placer
dans le même dossier, puis exécuter :

```bash
sha256sum --check pillbox-latest.apk.sha256
```

Le résultat attendu est `pillbox-latest.apk: OK`. Le workflow recalcule et vérifie ce
checksum après le build puis à nouveau juste avant la publication. Il contrôle aussi
que l’APK est présent, non vide, lisible comme archive Android, correctement signé et
qu’aucun nom de fichier interne n’évoque manifestement un keystore, une configuration
secrète ou une sauvegarde PillBox. Cette inspection ciblée ne constitue pas une preuve
d’absence totale de secrets dans l’APK.

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

### Réglages de sécurité GitHub à activer manuellement

Dans `Settings` → `Code security and analysis`, activer lorsque le plan GitHub du dépôt
le permet :

* les alertes Dependabot et les mises à jour de sécurité Dependabot ;
* le secret scanning et la push protection ;
* les règles de protection de `dev` et `main`, avec la CI requise avant fusion ;
* l’interdiction des pushs directs sur `main` ;
* les permissions du `GITHUB_TOKEN` : lecture par défaut et écriture du contenu
  effective uniquement pour le job de publication ;
* la présence des trois secrets de signature uniquement dans les réglages Actions.

Ces options dépendent de la configuration GitHub distante et ne peuvent pas être
garanties par les fichiers du dépôt. Le fichier `.github/dependabot.yml` limite les
mises à jour npm à un passage hebdomadaire et celles des GitHub Actions à un passage
mensuel. Les mises à jour de version ciblent `dev` ; les mises à jour de sécurité
continuent de cibler la branche par défaut et sont contrôlées par la CI sur `main`.

Expo, React, React Native et les modules natifs du SDK 54 sont entièrement exclus des
mises à jour de version Dependabot, correctifs compris : leurs versions forment un
ensemble imposé par le SDK et ne se choisissent pas dépendance par dépendance. Ces
paquets évoluent seulement lors d'un ticket de migration de SDK, avec les versions
rendues par `expo install` et un essai sur le téléphone Android cible. En contrepartie,
une alerte de sécurité portant sur l'un d'eux ne produira pas de pull request
automatique : elle doit être traitée par ce ticket de migration. La CI exécute
`expo install --check` et échoue si une mise à jour, Dependabot ou manuelle, écarte une
dépendance des versions attendues par le SDK.

Traiter une seule pull request Dependabot à la fois et ne jamais l'auto-fusionner. Un
correctif compatible peut être fusionné après une CI verte et un test rapide sur le
téléphone Android cible. Toute montée majeure, dépendance native, migration Expo ou
React Native, ou modification avec rupture nécessite un ticket technique dédié. Si un
correctif de sécurité compatible avec Expo SDK 54 n'existe pas, conserver la pull
request non fusionnée, documenter le risque et créer un ticket de migration Expo.
