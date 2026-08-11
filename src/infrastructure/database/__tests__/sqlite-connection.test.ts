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

  it('active le mode WAL, les clés étrangères et un délai d’attente avant de migrer', async () => {
    await initializeSQLiteDatabase(adapter(raw));

    expect(raw.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(raw.pragma('busy_timeout', { simple: true })).toBe(
      SQLITE_BUSY_TIMEOUT_MS,
    );
    expect(raw.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('applique bien les migrations jusqu’à la dernière version', async () => {
    await initializeSQLiteDatabase(adapter(raw));

    expect(
      raw
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get(),
    ).toEqual({ version: LATEST_SCHEMA_VERSION });
  });

  it("supprime en cascade les données d'un traitement, sans qu'aucun appel manuel ne soit nécessaire", async () => {
    await initializeSQLiteDatabase(adapter(raw));

    const treatment = raw
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000001', 'Doliprane')`,
      )
      .run();
    const treatmentId = treatment.lastInsertRowid;
    raw
      .prepare(
        `INSERT INTO treatment_phases (treatment_id, position, start_date, frequency_type)
         VALUES (?, 0, '2026-08-01', 'daily')`,
      )
      .run(treatmentId);
    raw
      .prepare(
        `INSERT INTO treatment_lifecycle_events (treatment_id, event_type)
         VALUES (?, 'DOSAGE_MODIFIED')`,
      )
      .run(treatmentId);

    raw.prepare('DELETE FROM treatments WHERE id = ?').run(treatmentId);

    expect(raw.prepare('SELECT * FROM treatment_phases').all()).toEqual([]);
    expect(
      raw.prepare('SELECT * FROM treatment_lifecycle_events').all(),
    ).toEqual([]);
  });
});
