import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { stableStringify, type PillBoxBackup } from '@/domain/backup/backup';
import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';

import {
  createBackup,
  parseAndValidateBackup,
  restoreBackup,
} from '../backup-repository';

type Parameters = readonly (string | number | null)[];

function digest(contents: string): Promise<string> {
  return Promise.resolve(createHash('sha256').update(contents).digest('hex'));
}

function adapter(
  raw: Database.Database,
  failOnTreatmentInsert = false,
): SQLiteDatabase {
  const api = {
    async getAllAsync<T>(sql: string, ...parameters: Parameters): Promise<T[]> {
      return raw.prepare(sql).all(...parameters) as T[];
    },
    async getFirstAsync<T>(
      sql: string,
      ...parameters: Parameters
    ): Promise<T | null> {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
    async runAsync(sql: string, ...parameters: Parameters) {
      if (failOnTreatmentInsert && sql.startsWith('INSERT INTO treatments'))
        throw new Error('échec injecté');
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

async function database(failOnTreatmentInsert = false) {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  for (const migration of SCHEMA_MIGRATIONS) {
    await migration.up({
      execute: (sql) => {
        raw.exec(sql);
        return Promise.resolve();
      },
      readAppliedVersions: () => Promise.resolve([]),
      recordAppliedVersion: () => Promise.resolve(),
    });
  }
  return { raw, database: adapter(raw, failOnTreatmentInsert) };
}

function seed(raw: Database.Database): void {
  raw.exec(`
    INSERT INTO treatments
      (id, specialty_cis, specialty_name, pharmaceutical_form, active, included_in_pillbox, created_at, updated_at)
    VALUES (12, '60001234', 'Traitement réel', 'comprimé', 1, 1, '2026-01-01', '2026-01-02');
    INSERT INTO treatment_phases
      (id, treatment_id, position, start_date, frequency_type)
    VALUES (20, 12, 0, '2026-01-01', 'daily');
    INSERT INTO treatment_phase_dosages (phase_id, weekday, slot, quantity_half_units)
    VALUES (20, '', 'morning', 1);
    INSERT INTO medication_boxes
      (id, specialty_cis, specialty_name, presentation_cip13, presentation_label, lot,
       expiration_date, initial_quantity, remaining_quantity, scan_raw)
    VALUES (30, '60001234', 'Traitement réel', '3400000000001', 'Boîte de 30', 'LOT-A',
            '2027-12-31', 30, 29.5, 'raw-datamatrix');
    INSERT INTO stock_movements
      (id, box_id, type, quantity_delta, quantity_after, explanation, created_at)
    VALUES (40, 30, 'BOX_ADDED', 30, 30, 'Ajout', '2026-01-01');
    UPDATE preparation_reminder_settings
      SET enabled = 1, weekday = 'monday', hour = 9, notification_id = 'native-id';
    UPDATE backup_settings SET last_successful_backup_at = '2026-02-01T10:00:00.000Z';
  `);
}

describe('sauvegarde et restauration personnelles', () => {
  it('effectue un round-trip sans perdre de donnée ni les identifiants', async () => {
    const source = await database();
    seed(source.raw);
    const backup = await createBackup(
      source.database,
      '2026-08-09T10:00:00.000Z',
      digest,
    );
    const target = await database();
    target.raw.exec(
      "INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('old', 'À remplacer')",
    );
    let safetyCopies = 0;

    await restoreBackup(target.database, backup, () => {
      safetyCopies += 1;
      return Promise.resolve();
    });
    const after = await createBackup(
      target.database,
      '2026-08-09T11:00:00.000Z',
      digest,
    );

    expect(after.tables).toEqual(backup.tables);
    expect(safetyCopies).toBe(1);
    expect(target.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    source.raw.close();
    target.raw.close();
  });

  it('accepte le schéma précédent compatible et initialise le nouveau réglage', async () => {
    const source = await database();
    seed(source.raw);
    const current = await createBackup(
      source.database,
      '2026-08-09T10:00:00.000Z',
      digest,
    );
    const {
      backup_settings: _backupSettings,
      privacy_settings: _privacySettings,
      treatment_reminder_settings: _treatmentReminders,
      intake_reminder_slot_settings: _slotSettings,
      ...schema9Tables
    } = current.tables;
    const contents = {
      metadata: { ...current.metadata, schemaVersion: 9 },
      tables: schema9Tables,
    };
    const schema9: PillBoxBackup = {
      ...contents,
      integrity: {
        algorithm: 'SHA-256',
        checksum: await digest(stableStringify(contents)),
      },
    };

    const parsed = await parseAndValidateBackup(
      JSON.stringify(schema9),
      digest,
    );
    const target = await database();
    await restoreBackup(target.database, parsed.backup, () =>
      Promise.resolve(),
    );

    expect(target.raw.prepare('SELECT * FROM backup_settings').get()).toEqual({
      singleton_id: 1,
      last_successful_backup_at: null,
    });
    target.raw.close();
    source.raw.close();
  });

  it('restaure un schéma 10 en désactivant le verrou absent du fichier', async () => {
    const source = await database();
    seed(source.raw);
    const current = await createBackup(
      source.database,
      '2026-08-09T10:00:00.000Z',
      digest,
    );
    const {
      privacy_settings: _omitted,
      treatment_reminder_settings: _treatmentReminders,
      intake_reminder_slot_settings: _slotSettings,
      ...schema10Tables
    } = current.tables;
    const contents = {
      metadata: { ...current.metadata, schemaVersion: 10 },
      tables: schema10Tables,
    };
    const schema10: PillBoxBackup = {
      ...contents,
      integrity: {
        algorithm: 'SHA-256',
        checksum: await digest(stableStringify(contents)),
      },
    };
    const target = await database();

    await restoreBackup(target.database, schema10, () => Promise.resolve());

    expect(
      target.raw.prepare('SELECT * FROM privacy_settings').get(),
    ).toMatchObject({ singleton_id: 1, app_lock_enabled: 0 });
    target.raw.close();
    source.raw.close();
  });

  it('refuse les formats trop anciens, trop récents et les fichiers corrompus', async () => {
    const source = await database();
    const backup = await createBackup(
      source.database,
      '2026-08-09T10:00:00.000Z',
      digest,
    );
    const tooRecent = {
      ...backup,
      metadata: { ...backup.metadata, schemaVersion: 14 },
    };
    const tooOld = {
      ...backup,
      metadata: { ...backup.metadata, schemaVersion: 8 },
    };
    const corrupted = JSON.parse(JSON.stringify(backup)) as PillBoxBackup;
    corrupted.integrity.checksum = '0'.repeat(64);

    await expect(
      parseAndValidateBackup(JSON.stringify(tooRecent), digest),
    ).rejects.toThrow('plus récente');
    await expect(
      parseAndValidateBackup(JSON.stringify(tooOld), digest),
    ).rejects.toThrow('trop ancienne');
    await expect(
      parseAndValidateBackup(JSON.stringify(corrupted), digest),
    ).rejects.toThrow(/incomplète|intégrité/);
    source.raw.close();
  });

  it('conserve intégralement l’état précédent si une insertion échoue', async () => {
    const source = await database();
    seed(source.raw);
    const backup = await createBackup(
      source.database,
      '2026-08-09T10:00:00.000Z',
      digest,
    );
    const target = await database(true);
    target.raw.exec(
      "INSERT INTO treatments (id, specialty_cis, specialty_name) VALUES (99, 'old', 'État courant')",
    );

    await expect(
      restoreBackup(target.database, backup, () => Promise.resolve()),
    ).rejects.toThrow('échec injecté');
    expect(
      target.raw.prepare('SELECT id, specialty_name FROM treatments').all(),
    ).toEqual([{ id: 99, specialty_name: 'État courant' }]);
    target.raw.close();
    source.raw.close();
  });

  it('ne touche pas aux données si la copie de sécurité échoue', async () => {
    const source = await database();
    seed(source.raw);
    const backup = await createBackup(
      source.database,
      '2026-08-09T10:00:00.000Z',
      digest,
    );
    const target = await database();
    target.raw.exec(
      "INSERT INTO treatments (id, specialty_cis, specialty_name) VALUES (99, 'old', 'État courant')",
    );

    await expect(
      restoreBackup(target.database, backup, () =>
        Promise.reject(new Error('stockage indisponible')),
      ),
    ).rejects.toThrow('stockage indisponible');
    expect(target.raw.prepare('SELECT id FROM treatments').all()).toEqual([
      { id: 99 },
    ]);
    target.raw.close();
    source.raw.close();
  });
});
