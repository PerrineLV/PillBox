import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQLiteDatabase } from 'expo-sqlite';

import { LATEST_SCHEMA_VERSION } from '../schema-migrations';
import {
  initializeSQLiteDatabase,
  SQLITE_BUSY_TIMEOUT_MS,
} from '../sqlite-connection';

type SqlParameters = readonly (string | number | null)[];

function adapter(raw: Database.Database): SQLiteDatabase {
  const api = {
    async execAsync(sql: string) {
      raw.exec(sql);
    },
    async getAllAsync<T>(sql: string, ...parameters: SqlParameters) {
      return raw.prepare(sql).all(...parameters) as T[];
    },
    async getFirstAsync<T>(sql: string, ...parameters: SqlParameters) {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
    async runAsync(sql: string, ...parameters: SqlParameters) {
      const result = raw.prepare(sql).run(...parameters);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    async withExclusiveTransactionAsync(
      task: (transaction: SQLiteDatabase) => Promise<void>,
    ) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        await task(api as unknown as SQLiteDatabase);
        raw.exec('COMMIT');
      } catch (reason: unknown) {
        raw.exec('ROLLBACK');
        throw reason;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}

describe('initialisation de la connexion locale', () => {
  // Le mode WAL n’existe que pour une base sur disque : la vérification porte
  // donc sur un fichier temporaire, supprimé à la fin du test.
  let directory = '';
  let raw: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pillbox-sqlite-'));
    raw = new Database(join(directory, 'pillbox.db'));
  });

  afterEach(() => {
    raw.close();
    rmSync(directory, { force: true, recursive: true });
  });

  it('active le mode WAL et un délai d’attente avant de migrer', async () => {
    await initializeSQLiteDatabase(adapter(raw));

    expect(raw.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(raw.pragma('busy_timeout', { simple: true })).toBe(
      SQLITE_BUSY_TIMEOUT_MS,
    );
  });

  it('applique bien les migrations jusqu’à la dernière version', async () => {
    await initializeSQLiteDatabase(adapter(raw));

    expect(
      raw
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get(),
    ).toEqual({ version: LATEST_SCHEMA_VERSION });
  });
});
