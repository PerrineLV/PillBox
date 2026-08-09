import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { intakeRecordKey } from '@/domain/intakes/intake-tracking';
import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  archiveTreatment,
  getTreatmentRemovalAction,
  updateTreatment,
} from '@/infrastructure/treatments/treatment-repository';
import {
  deleteIntakePostponement,
  getIntakePostponement,
  listIntakeHistory,
  materializeIntakeSnapshots,
  saveIntakePostponement,
  updateIntakeGroupStatus,
  updateIntakeStatus,
} from '../intake-repository';

type Parameter = string | number | null;
function adapter(raw: Database.Database): SQLiteDatabase {
  const api = {
    async getFirstAsync<T>(sql: string, ...parameters: Parameter[]) {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...parameters: Parameter[]) {
      return raw.prepare(sql).all(...parameters) as T[];
    },
    async runAsync(sql: string, ...parameters: Parameter[]) {
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
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}
async function setup() {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  for (const migration of SCHEMA_MIGRATIONS)
    await migration.up({
      execute(sql) {
        raw.exec(sql);
        return Promise.resolve();
      },
      readAppliedVersions: () => Promise.resolve([]),
      recordAppliedVersion: () => Promise.resolve(),
    });
  raw.exec(`INSERT INTO treatments (id, specialty_cis, specialty_name, pharmaceutical_form) VALUES (1, 'cis-1', 'Alpha', 'comprimé');
    INSERT INTO treatment_phases (id, treatment_id, position, start_date, frequency_type) VALUES (10, 1, 0, '2026-08-01', 'daily');
    INSERT INTO treatment_phase_dosages (phase_id, slot, quantity_half_units) VALUES (10, 'morning', 2);`);
  return { raw, database: adapter(raw) };
}
const snapshot = {
  key: intakeRecordKey(1, '2026-08-10', 'morning'),
  treatmentId: 1,
  date: '2026-08-10',
  slot: 'morning' as const,
  specialtyCis: 'cis-1',
  specialtyName: 'Alpha',
  pharmaceuticalForm: 'comprimé',
  quantityHalfUnits: 2,
};

describe('suivi local des prises', () => {
  it('distingue les trois statuts et permet une correction ultérieure sans toucher au stock', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [snapshot]);
    expect(
      (
        await listIntakeHistory(database, {
          startDate: null,
          endDate: '2026-08-31',
          treatmentId: null,
        })
      )[0].status,
    ).toBe('UNSET');
    await updateIntakeStatus(database, snapshot.key, 'TAKEN');
    await updateIntakeStatus(database, snapshot.key, 'SKIPPED');
    await updateIntakeStatus(database, snapshot.key, 'UNSET');
    expect(
      (
        await listIntakeHistory(database, {
          startDate: null,
          endDate: '2026-08-31',
          treatmentId: null,
        })
      )[0].status,
    ).toBe('UNSET');
    expect(
      raw.prepare('SELECT COUNT(*) count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
    raw.close();
  });

  it('valide transactionnellement tous les médicaments d’un créneau', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [
      snapshot,
      {
        ...snapshot,
        key: intakeRecordKey(2, '2026-08-10', 'morning'),
        treatmentId: 2,
        specialtyCis: 'cis-2',
        specialtyName: 'Beta',
      },
      {
        ...snapshot,
        key: intakeRecordKey(1, '2026-08-10', 'noon'),
        slot: 'noon',
      },
    ]);

    await updateIntakeGroupStatus(database, '2026-08-10', 'morning', 'TAKEN');

    expect(
      raw
        .prepare(
          `SELECT specialty_name, status FROM intake_records
           ORDER BY slot, specialty_name`,
        )
        .all(),
    ).toEqual([
      { specialty_name: 'Alpha', status: 'TAKEN' },
      { specialty_name: 'Beta', status: 'TAKEN' },
      { specialty_name: 'Alpha', status: 'UNSET' },
    ]);
    expect(
      raw.prepare('SELECT COUNT(*) count FROM stock_movements').get(),
    ).toEqual({
      count: 0,
    });
    raw.close();
  });

  it('préserve identité et snapshot après recalcul, recréation des phases et archivage', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [snapshot]);
    await materializeIntakeSnapshots(database, [
      { ...snapshot, specialtyName: 'Nom modifié', quantityHalfUnits: 6 },
    ]);
    await updateTreatment(database, {
      id: 1,
      specialtyCis: 'cis-1',
      specialtyName: 'Alpha modifié',
      pharmaceuticalForm: 'gélule',
      includedInPillbox: true,
      archivedAt: null,
      phases: [
        {
          id: null,
          startDate: '2026-08-01',
          endDate: null,
          frequency: { type: 'daily' },
          dosage: [{ slot: 'morning', quantityHalfUnits: 4 }],
        },
      ],
    });
    expect(await getTreatmentRemovalAction(database, 1)).toBe('ARCHIVE');
    await archiveTreatment(database, 1);
    const record = (
      await listIntakeHistory(database, {
        startDate: null,
        endDate: '2026-08-31',
        treatmentId: 1,
      })
    )[0];
    expect(record).toMatchObject({
      key: snapshot.key,
      specialtyName: 'Alpha',
      pharmaceuticalForm: 'comprimé',
      quantityHalfUnits: 2,
    });
    expect(
      raw.prepare('SELECT COUNT(*) count FROM intake_records').get(),
    ).toEqual({ count: 1 });
    raw.close();
  });

  it('remplace, isole et annule un report par date et créneau', async () => {
    const { raw, database } = await setup();
    await saveIntakePostponement(database, {
      date: '2026-08-10',
      slot: 'morning',
      scheduledAt: '2026-08-10T09:00:00.000Z',
      notificationId: 'one',
    });
    await saveIntakePostponement(database, {
      date: '2026-08-10',
      slot: 'noon',
      scheduledAt: '2026-08-10T09:00:00.000Z',
      notificationId: 'two',
    });
    await saveIntakePostponement(database, {
      date: '2026-08-10',
      slot: 'morning',
      scheduledAt: '2026-08-10T10:00:00.000Z',
      notificationId: 'replacement',
    });
    expect(
      (await getIntakePostponement(database, '2026-08-10', 'morning'))
        ?.notificationId,
    ).toBe('replacement');
    expect(
      (await getIntakePostponement(database, '2026-08-10', 'noon'))
        ?.notificationId,
    ).toBe('two');
    await deleteIntakePostponement(database, '2026-08-10', 'morning');
    expect(
      await getIntakePostponement(database, '2026-08-10', 'morning'),
    ).toBeNull();
    expect(
      await getIntakePostponement(database, '2026-08-10', 'noon'),
    ).not.toBeNull();
    raw.close();
  });
});
