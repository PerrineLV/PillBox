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
