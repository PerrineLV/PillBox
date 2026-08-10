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
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { migrateSQLiteDatabase } from './sqlite-migrations';

export const SQLITE_BUSY_TIMEOUT_MS = 5000;

export const SQLITE_CONNECTION_PRAGMAS = [
  'PRAGMA journal_mode = WAL;',
  `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`,
].join('\n');

/** Point d’entrée `onInit` : configure la connexion puis met le schéma à jour. */
export async function initializeSQLiteDatabase(
  database: SQLiteDatabase,
): Promise<void> {
  await database.execAsync(SQLITE_CONNECTION_PRAGMAS);
  await migrateSQLiteDatabase(database);
}
