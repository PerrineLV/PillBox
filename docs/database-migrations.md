# Migrations SQLite

La version courante du schéma est `LATEST_SCHEMA_VERSION`, dans
`src/infrastructure/database/schema-migrations.ts`. La table technique
`schema_migrations` conserve chaque version appliquée. Elle est la source de vérité de
l’historique du schéma.

Au démarrage, les migrations manquantes sont exécutées dans l’ordre, dans une unique
transaction exclusive. Chaque version n’est enregistrée qu’après le succès de son
contenu. Une erreur provoque le rollback de toutes les étapes tentées pendant ce
démarrage : la base reste exactement dans sa version antérieure. L’application ne
supprime et ne recrée jamais automatiquement la base.

## Accès concurrents au démarrage

Avant les migrations, `initializeSQLiteDatabase`
(`src/infrastructure/database/sqlite-connection.ts`) active le mode WAL et un
`busy_timeout`. WAL est persistant dans le fichier : les connexions ouvertes ensuite
par `withExclusiveTransactionAsync`, qui en crée une par transaction, en héritent. Une
lecture n’est donc jamais bloquée par une écriture en cours.

Deux écritures transactionnelles simultanées restent en revanche incompatibles. Les
accès lancés automatiquement au démarrage et au retour au premier plan passent pour
cette raison par une file d’exécution sérielle
(`src/infrastructure/database/serial-task-queue.ts`), partagée via
`useDatabaseTaskQueue()` : synchronisation des rappels, réconciliation des reports,
action rapide d’une notification et cache de détection de version s’exécutent l’un
après l’autre. Une action rapide de notification passe devant celles qui attendent.

Restent hors de la file, volontairement :

- la lecture du réglage de verrou, qui conditionne l’affichage et ne doit pas attendre
  la fin d’une synchronisation ;
- l’appel réseau de la détection de version, qui ne touche pas la base ;
- les écritures déclenchées par une action explicite à l’écran.

## Ajouter une migration

1. Ne jamais modifier une migration déjà livrée.
2. Incrémenter `LATEST_SCHEMA_VERSION` d’une unité.
3. Ajouter à la fin de `SCHEMA_MIGRATIONS` une entrée dont `version` correspond à cette
   nouvelle valeur. Les versions doivent être continues, sans doublon ni trou.
4. Écrire une migration déterministe et conservatrice. Préférer les opérations
   additives et `IF NOT EXISTS`. Ne jamais supprimer silencieusement une table, une
   colonne ou des données.
5. Ne pas ajouter `BEGIN`, `COMMIT` ou `ROLLBACK` dans la migration : le runner fournit
   déjà la transaction.

Exemple :

```ts
{
  version: 2,
  name: 'ajout d’une table exemple',
  async up(transaction) {
    await transaction.execute(`
      CREATE TABLE IF NOT EXISTS example (
        id INTEGER PRIMARY KEY NOT NULL
      );
    `);
  },
}
```

## Tester une migration

Ajouter des cas couvrant :

- une base neuve jusqu’à la dernière version ;
- le passage depuis chacune des versions antérieures encore connues ;
- un second lancement sans nouvelle exécution ;
- un échec après une modification partielle, avec vérification du rollback et de la
  version inchangée.

Exécuter ensuite :

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
```
