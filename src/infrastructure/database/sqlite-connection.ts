/**
 * Réglages appliqués à la connexion locale avant toute migration.
 *
 * En mode journal par défaut, une écriture bloque toute lecture concurrente :
 * au lancement, les lectures des composants montés sous `DatabaseProvider`
 * échouaient alors par intermittence avec « database is locked ». Le mode WAL
 * découple lectures et écritures, et il est persistant dans le fichier : les
 * connexions ouvertes ensuite par `withExclusiveTransactionAsync` en héritent.
 *
 * `busy_timeout` fait patienter cette connexion au lieu d’échouer aussitôt,
 * pour absorber les accès concurrents résiduels. Cinq secondes couvrent
 * largement une écriture locale sans jamais figer durablement un écran.
 *
 * `foreign_keys` n'est, à l'inverse du mode WAL, jamais persistant dans le
 * fichier : SQLite le désactive par défaut à chaque nouvelle connexion. Sans
 * cette ligne, les `ON DELETE CASCADE`/`ON DELETE RESTRICT` déjà déclarés dans
 * le schéma (`schema-migrations.ts`) ne sont pas appliqués par la connexion
 * de production — seuls les tests l'activaient jusqu'ici, ce qui masquait le
 * problème. `backup-validator.ts` l'active déjà sur sa connexion temporaire
 * de validation : ce réglage complète ce qui existait déjà, sans rien changer
 * pour tout le code qui supprime déjà ses lignes filles dans le bon ordre.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { migrateSQLiteDatabase } from './sqlite-migrations';

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

export const SQLITE_CONNECTION_PRAGMAS = [
  'PRAGMA journal_mode = WAL;',
  `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`,
  'PRAGMA foreign_keys = ON;',
].join('\n');

/** Point d’entrée `onInit` : configure la connexion puis met le schéma à jour. */
export async function initializeSQLiteDatabase(
  database: SQLiteDatabase,
): Promise<void> {
  await database.execAsync(SQLITE_CONNECTION_PRAGMAS);
  await migrateSQLiteDatabase(database);
}
