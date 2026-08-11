import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { generatePreparationSnapshot } from '@/domain/preparations/preparation';
import { generateIntakes } from '@/domain/treatments/generate-intakes';
import { isLegacyTreatmentPhase } from '@/domain/treatments/treatment';
import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  archiveTreatment,
  deleteUnusedTreatment,
  getTreatment,
  getTreatmentRemovalAction,
  restoreArchivedTreatment,
  updateTreatment,
} from '../treatment-repository';

type Parameters = readonly (string | number | null)[];
type TestDatabase = {
  getFirstAsync<T>(sql: string, ...parameters: Parameters): Promise<T | null>;
  getAllAsync<T>(sql: string, ...parameters: Parameters): Promise<T[]>;
  runAsync(
    sql: string,
    ...parameters: Parameters
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  withExclusiveTransactionAsync(
    task: (transaction: TestDatabase) => Promise<void>,
  ): Promise<void>;
};

function adapter(raw: Database.Database): SQLiteDatabase {
  const database: TestDatabase = {
    async getFirstAsync<T>(sql: string, ...parameters: Parameters) {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...parameters: Parameters) {
      return raw.prepare(sql).all(...parameters) as T[];
    },
    async runAsync(sql: string, ...parameters: Parameters) {
      const result = raw.prepare(sql).run(...parameters);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    async withExclusiveTransactionAsync(task) {
      raw.exec('BEGIN IMMEDIATE');
      try {
        await task(database);
        raw.exec('COMMIT');
      } catch (error: unknown) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return database as unknown as SQLiteDatabase;
}

async function setup() {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  for (const migration of SCHEMA_MIGRATIONS) {
    await migration.up({
      execute(sql) {
        raw.exec(sql);
        return Promise.resolve();
      },
      readAppliedVersions: () => Promise.resolve([]),
      recordAppliedVersion: () => Promise.resolve(),
    });
  }
  const treatmentId = Number(
    raw
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000001', 'Alpha')`,
      )
      .run().lastInsertRowid,
  );
  const phaseId = Number(
    raw
      .prepare(
        `INSERT INTO treatment_phases (treatment_id, position, start_date, frequency_type)
     VALUES (?, 0, '2026-08-01', 'daily')`,
      )
      .run(treatmentId).lastInsertRowid,
  );
  raw
    .prepare(
      `INSERT INTO treatment_phase_dosages (phase_id, slot, quantity_half_units)
     VALUES (?, 'morning', 2)`,
    )
    .run(phaseId);
  return { raw, database: adapter(raw), treatmentId };
}

function useInPreparation(
  raw: Database.Database,
  treatmentId: number,
  status: 'DRAFT' | 'COMPLETED' = 'DRAFT',
) {
  const completedAt = status === 'COMPLETED' ? ', completed_at' : '';
  const completedValue = status === 'COMPLETED' ? ', CURRENT_TIMESTAMP' : '';
  const preparationId = Number(
    raw
      .prepare(
        `INSERT INTO preparations (start_date, end_date, status${completedAt})
     VALUES ('2026-08-10', '2026-08-16', ?${completedValue})`,
      )
      .run(status).lastInsertRowid,
  );
  raw
    .prepare(
      `INSERT INTO preparation_items
     (preparation_id, source_treatment_id, specialty_cis, specialty_name, intake_date, slot, quantity_half_units)
     VALUES (?, ?, '60000001', 'Nom historique', '2026-08-10', 'morning', 2)`,
    )
    .run(preparationId, treatmentId);
  return preparationId;
}

describe('suppression et archivage des traitements', () => {
  it('ne laisse pas l’ancien marqueur inactif exclure un traitement non archivé', async () => {
    const { raw, database, treatmentId } = await setup();
    raw
      .prepare('UPDATE treatments SET active = 0 WHERE id = ?')
      .run(treatmentId);

    const treatment = await getTreatment(database, treatmentId);

    expect(
      generateIntakes(treatment ? [treatment] : [], '2026-08-03', '2026-08-03'),
    ).toHaveLength(1);
    raw.close();
  });

  it('supprime définitivement un traitement jamais utilisé et ses posologies en cascade', async () => {
    const { raw, database, treatmentId } = await setup();
    expect(await getTreatmentRemovalAction(database, treatmentId)).toBe(
      'DELETE',
    );

    await deleteUnusedTreatment(database, treatmentId);

    expect(raw.prepare('SELECT COUNT(*) count FROM treatments').get()).toEqual({
      count: 0,
    });
    expect(
      raw.prepare('SELECT COUNT(*) count FROM treatment_phases').get(),
    ).toEqual({ count: 0 });
    expect(
      raw.prepare('SELECT COUNT(*) count FROM treatment_phase_dosages').get(),
    ).toEqual({ count: 0 });
    raw.close();
  });

  it('autorise la suppression malgré des prises planifiées jamais prises ni ignorées (UNSET)', async () => {
    const { raw, database, treatmentId } = await setup();
    raw
      .prepare(
        `INSERT INTO intake_records
         (intake_key, source_treatment_id, intake_date, slot, specialty_cis,
          specialty_name, quantity_half_units)
         VALUES ('k1', ?, '2026-08-04', 'morning', '60000001', 'Alpha', 2)`,
      )
      .run(treatmentId);

    expect(await getTreatmentRemovalAction(database, treatmentId)).toBe(
      'DELETE',
    );

    await deleteUnusedTreatment(database, treatmentId);

    expect(raw.prepare('SELECT COUNT(*) count FROM treatments').get()).toEqual({
      count: 0,
    });
    expect(
      raw.prepare('SELECT COUNT(*) count FROM intake_records').get(),
    ).toEqual({ count: 0 });
    raw.close();
  });

  it.each(['TAKEN', 'SKIPPED'] as const)(
    'interdit la suppression dès qu’une prise a été %s',
    async (status) => {
      const { raw, database, treatmentId } = await setup();
      raw
        .prepare(
          `INSERT INTO intake_records
           (intake_key, source_treatment_id, intake_date, slot, specialty_cis,
            specialty_name, quantity_half_units, status)
           VALUES ('k1', ?, '2026-08-04', 'morning', '60000001', 'Alpha', 2, ?)`,
        )
        .run(treatmentId, status);

      expect(await getTreatmentRemovalAction(database, treatmentId)).toBe(
        'ARCHIVE',
      );
      await expect(
        deleteUnusedTreatment(database, treatmentId),
      ).rejects.toThrow('ne peut pas être supprimé');
      raw.close();
    },
  );

  it.each(['DRAFT', 'COMPLETED'] as const)(
    'interdit la suppression après utilisation dans une préparation %s',
    async (status) => {
      const { raw, database, treatmentId } = await setup();
      useInPreparation(raw, treatmentId, status);

      await expect(
        deleteUnusedTreatment(database, treatmentId),
      ).rejects.toThrow('ne peut pas être supprimé');
      expect(await getTreatment(database, treatmentId)).not.toBeNull();
      raw.close();
    },
  );

  it('archive sans altérer les posologies ni le snapshot historique et l’exclut des futures préparations', async () => {
    const { raw, database, treatmentId } = await setup();
    const preparationId = useInPreparation(raw, treatmentId, 'COMPLETED');

    await archiveTreatment(database, treatmentId);

    const treatment = await getTreatment(database, treatmentId);
    expect(treatment).toMatchObject({
      includedInPillbox: true,
    });
    expect(treatment?.archivedAt).not.toBeNull();
    expect(treatment?.phases[0].dosage).toEqual([
      { slot: 'morning', quantityHalfUnits: 2 },
    ]);
    const future = generatePreparationSnapshot(
      treatment ? [treatment] : [],
      [],
      '2026-08-17',
      '2026-08-09',
    );
    expect(future.items).toEqual([]);
    expect(
      raw
        .prepare(
          `SELECT source_treatment_id, specialty_name, intake_date, quantity_half_units
       FROM preparation_items WHERE preparation_id = ?`,
        )
        .get(preparationId),
    ).toEqual({
      source_treatment_id: treatmentId,
      specialty_name: 'Nom historique',
      intake_date: '2026-08-10',
      quantity_half_units: 2,
    });
    raw.close();
  });

  it('permet de restaurer un traitement archivé sans modifier son inclusion dans le pilulier', async () => {
    const { raw, database, treatmentId } = await setup();
    raw
      .prepare('UPDATE treatments SET included_in_pillbox = 0 WHERE id = ?')
      .run(treatmentId);
    useInPreparation(raw, treatmentId);
    await archiveTreatment(database, treatmentId);

    await restoreArchivedTreatment(database, treatmentId);

    expect(await getTreatment(database, treatmentId)).toMatchObject({
      includedInPillbox: false,
      archivedAt: null,
    });
    raw.close();
  });

  it('journalise l’archivage puis la réactivation pour la timeline', async () => {
    const { raw, database, treatmentId } = await setup();
    useInPreparation(raw, treatmentId, 'COMPLETED');

    await archiveTreatment(database, treatmentId);
    await restoreArchivedTreatment(database, treatmentId);

    expect(
      raw
        .prepare(
          'SELECT event_type FROM treatment_lifecycle_events WHERE treatment_id = ? ORDER BY id',
        )
        .all(treatmentId),
    ).toEqual([{ event_type: 'ARCHIVED' }, { event_type: 'REACTIVATED' }]);
    raw.close();
  });

  it('journalise un changement de posologie mais pas une simple modification d’un autre champ', async () => {
    const { raw, database, treatmentId } = await setup();
    const treatment = await getTreatment(database, treatmentId);
    if (treatment === null) throw new Error('Traitement introuvable.');

    await updateTreatment(database, {
      ...treatment,
      specialtyName: 'Nouveau nom, même posologie',
    });

    expect(
      raw
        .prepare(
          'SELECT COUNT(*) AS count FROM treatment_lifecycle_events WHERE treatment_id = ?',
        )
        .get(treatmentId),
    ).toEqual({ count: 0 });

    const reloaded = await getTreatment(database, treatmentId);
    if (reloaded === null) throw new Error('Traitement introuvable.');
    const [phase] = reloaded.phases;
    if (isLegacyTreatmentPhase(phase)) throw new Error('Phase inattendue.');
    await updateTreatment(database, {
      ...reloaded,
      phases: [
        {
          ...phase,
          dosage: [{ slot: 'morning', quantityHalfUnits: 4 }],
        },
      ],
    });

    expect(
      raw
        .prepare(
          'SELECT event_type FROM treatment_lifecycle_events WHERE treatment_id = ?',
        )
        .all(treatmentId),
    ).toEqual([{ event_type: 'DOSAGE_MODIFIED' }]);
    raw.close();
  });
});
