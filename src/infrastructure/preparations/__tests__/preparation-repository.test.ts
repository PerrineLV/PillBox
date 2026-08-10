import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  preparationEndDate,
  type PreparationSnapshot,
} from '@/domain/preparations/preparation';

import {
  cancelPreparation,
  completePreparation,
  createPreparation,
  getLatestDraftPreparation,
  listPreparationHistory,
  listPreparationWeeks,
  savePreparationProgress,
} from '../preparation-repository';

type SqlParameters = readonly (string | number | null)[];
type TestDatabase = Readonly<{
  getFirstAsync<T>(
    sql: string,
    ...parameters: SqlParameters
  ): Promise<T | null>;
  getAllAsync<T>(sql: string, ...parameters: SqlParameters): Promise<T[]>;
  runAsync(
    sql: string,
    ...parameters: SqlParameters
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  withExclusiveTransactionAsync(
    task: (transaction: TestDatabase) => Promise<void>,
  ): Promise<void>;
}>;

function expoAdapter(
  database: Database.Database,
  failOnSecondPreparationMovement: boolean,
): SQLiteDatabase {
  let preparationMovementCount = 0;
  const api: TestDatabase = {
    async getFirstAsync<T>(
      sql: string,
      ...parameters: SqlParameters
    ): Promise<T | null> {
      return (
        (database.prepare(sql).get(...parameters) as T | undefined) ?? null
      );
    },
    async getAllAsync<T>(
      sql: string,
      ...parameters: SqlParameters
    ): Promise<T[]> {
      return database.prepare(sql).all(...parameters) as T[];
    },
    async runAsync(sql: string, ...parameters: SqlParameters) {
      if (sql.includes('INSERT INTO stock_movements')) {
        preparationMovementCount += 1;
        if (failOnSecondPreparationMovement && preparationMovementCount === 2) {
          throw new Error('échec injecté');
        }
      }
      const result = database.prepare(sql).run(...parameters);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
    async withExclusiveTransactionAsync(task) {
      database.exec('BEGIN IMMEDIATE');
      try {
        await task(api);
        database.exec('COMMIT');
      } catch (error: unknown) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}

async function createDatabase(
  failOnSecondPreparationMovement = false,
): Promise<{
  raw: Database.Database;
  database: SQLiteDatabase;
}> {
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
  return { raw, database: expoAdapter(raw, failOnSecondPreparationMovement) };
}

function seedPreparation(
  raw: Database.Database,
  medicationCount = 1,
  verification: 'SCAN' | 'MANUAL' = 'SCAN',
): number {
  const preparationId = Number(
    raw
      .prepare(
        `INSERT INTO preparations (start_date, end_date) VALUES ('2026-08-10', '2026-08-16')`,
      )
      .run().lastInsertRowid,
  );
  for (let index = 1; index <= medicationCount; index += 1) {
    const cis = `6000000${index}`;
    const boxId = Number(
      raw
        .prepare(
          `INSERT INTO medication_boxes
         (specialty_cis, specialty_name, presentation_cip13, presentation_label,
          lot, expiration_date, initial_quantity, remaining_quantity, scan_raw)
         VALUES (?, ?, ?, 'Boîte', ?, '2027-01-01', 10, 10, 'raw')`,
        )
        .run(cis, `Médicament ${index}`, `340000000000${index}`, `LOT-${index}`)
        .lastInsertRowid,
    );
    raw
      .prepare(
        `INSERT INTO preparation_requirements
       VALUES (?, ?, ?, 7, 20, 0)`,
      )
      .run(preparationId, cis, `Médicament ${index}`);
    raw
      .prepare(
        `INSERT INTO preparation_progress
       (preparation_id, specialty_cis, box_id, verification, scan_raw)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        preparationId,
        cis,
        boxId,
        verification,
        verification === 'SCAN' ? 'scan' : '',
      );
  }
  return preparationId;
}

function weekSnapshot(startDate: string): PreparationSnapshot {
  return {
    startDate,
    endDate: preparationEndDate(startDate),
    items: [
      {
        treatmentId: 1,
        specialtyCis: '60000001',
        specialtyName: 'Médicament 1',
        pharmaceuticalForm: 'comprimé',
        date: startDate,
        slot: 'morning',
        quantityHalfUnits: 1,
      },
    ],
    requirements: [
      {
        specialtyCis: '60000001',
        specialtyName: 'Médicament 1',
        requiredHalfUnits: 7,
        usableStockHalfUnits: 20,
        missingHalfUnits: 0,
      },
    ],
    hasShortages: false,
  };
}

function countOf(raw: Database.Database, table: string): number {
  return (
    raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

describe('annulation d’une préparation en cours', () => {
  it('efface la préparation sans mouvement de stock ni trace dans l’historique', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);

    await cancelPreparation(database, id);

    expect(countOf(raw, 'preparations')).toBe(0);
    expect(countOf(raw, 'preparation_progress')).toBe(0);
    expect(countOf(raw, 'preparation_requirements')).toBe(0);
    expect(countOf(raw, 'preparation_items')).toBe(0);
    expect(countOf(raw, 'stock_movements')).toBe(0);
    expect(
      raw.prepare('SELECT remaining_quantity FROM medication_boxes').get(),
    ).toEqual({ remaining_quantity: 10 });
    expect(await listPreparationHistory(database)).toEqual([]);
    expect(await getLatestDraftPreparation(database)).toBeNull();
    raw.close();
  });

  it('refuse d’annuler une préparation déjà validée', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);
    await completePreparation(database, id, '2026-08-09');

    await expect(cancelPreparation(database, id)).rejects.toThrow(
      'déjà terminée',
    );

    expect(countOf(raw, 'preparations')).toBe(1);
    expect(countOf(raw, 'stock_movements')).toBe(1);
    expect(
      raw.prepare('SELECT remaining_quantity FROM medication_boxes').get(),
    ).toEqual({ remaining_quantity: 6.5 });
    expect(await listPreparationHistory(database)).toHaveLength(1);
    raw.close();
  });

  it('refuse d’annuler une préparation qui a déjà touché au stock', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);
    raw
      .prepare(
        `INSERT INTO stock_movements
          (box_id, preparation_id, type, quantity_delta, quantity_after, explanation)
         VALUES (1, ?, 'PILLBOX_PREPARATION', -3.5, 6.5, 'mouvement incohérent')`,
      )
      .run(id);

    await expect(cancelPreparation(database, id)).rejects.toThrow(
      'mouvements de stock',
    );

    expect(countOf(raw, 'preparations')).toBe(1);
    expect(countOf(raw, 'stock_movements')).toBe(1);
    raw.close();
  });

  it('reste sans effet lorsque la préparation a déjà été annulée', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);

    await cancelPreparation(database, id);
    await expect(cancelPreparation(database, id)).resolves.toBeUndefined();

    expect(countOf(raw, 'preparations')).toBe(0);
    raw.close();
  });
});

describe('choix de la semaine préparée', () => {
  it('crée la préparation demandée et la liste comme semaine en cours', async () => {
    const { raw, database } = await createDatabase();

    const id = await createPreparation(database, weekSnapshot('2026-08-17'));

    expect(await listPreparationWeeks(database)).toEqual([
      { id, startDate: '2026-08-17', status: 'DRAFT' },
    ]);
    raw.close();
  });

  it('refuse un doublon pour une semaine déjà validée', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);
    await completePreparation(database, id, '2026-08-09');

    await expect(
      createPreparation(database, weekSnapshot('2026-08-10')),
    ).rejects.toThrow('déjà été préparée');

    expect(countOf(raw, 'preparations')).toBe(1);
    raw.close();
  });

  it('refuse une seconde préparation en cours pour une autre semaine', async () => {
    const { raw, database } = await createDatabase();
    seedPreparation(raw);

    await expect(
      createPreparation(database, weekSnapshot('2026-08-17')),
    ).rejects.toThrow('déjà en cours');

    expect(countOf(raw, 'preparations')).toBe(1);
    raw.close();
  });

  it('libère la semaine après une annulation', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);
    await cancelPreparation(database, id);

    const recreated = await createPreparation(
      database,
      weekSnapshot('2026-08-10'),
    );

    expect(await listPreparationWeeks(database)).toEqual([
      { id: recreated, startDate: '2026-08-10', status: 'DRAFT' },
    ]);
    raw.close();
  });
});

describe('validation transactionnelle d’une préparation', () => {
  it('décrémente exactement le lot utilisé, crée le mouvement et complète la préparation', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);

    await completePreparation(database, id, '2026-08-09');

    expect(
      raw.prepare('SELECT status FROM preparations WHERE id = ?').get(id),
    ).toEqual({ status: 'COMPLETED' });
    expect(
      raw.prepare('SELECT remaining_quantity FROM medication_boxes').get(),
    ).toEqual({ remaining_quantity: 6.5 });
    expect(
      raw
        .prepare(
          `SELECT type, quantity_delta, preparation_id FROM stock_movements`,
        )
        .get(),
    ).toEqual({
      type: 'PILLBOX_PREPARATION',
      quantity_delta: -3.5,
      preparation_id: id,
    });
    const history = await listPreparationHistory(database);
    expect(history[0].medications[0]).toMatchObject({
      specialtyName: 'Médicament 1',
      quantityHalfUnits: 7,
      lot: 'LOT-1',
      presentationCip13: '3400000000001',
      verification: 'SCAN',
    });
    raw.close();
  });

  it('distingue dans l’historique une boîte choisie sans scan', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw, 1, 'MANUAL');

    await completePreparation(database, id, '2026-08-09');

    const history = await listPreparationHistory(database);
    expect(history[0].medications[0]).toMatchObject({
      lot: 'LOT-1',
      verification: 'MANUAL',
    });
    raw.close();
  });

  it('refuse d’enregistrer une vérification par scan sans chaîne brute', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);

    await expect(
      savePreparationProgress(database, id, {
        specialtyCis: '60000001',
        boxId: 1,
        verification: 'SCAN',
        scanRaw: null,
        nonFefoAcknowledged: false,
      }),
    ).rejects.toThrow('brute');
    raw.close();
  });

  it('reprend une progression sans scan sans inventer de preuve de lecture', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);

    await savePreparationProgress(database, id, {
      specialtyCis: '60000001',
      boxId: 1,
      verification: 'MANUAL',
      scanRaw: null,
      nonFefoAcknowledged: false,
    });

    const saved = await getLatestDraftPreparation(database);
    expect(saved?.progress[0]).toMatchObject({
      verification: 'MANUAL',
      scanRaw: null,
    });
    raw.close();
  });

  it('refuse une seconde validation sans redécrémenter le stock', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);
    await completePreparation(database, id, '2026-08-09');

    await expect(
      completePreparation(database, id, '2026-08-09'),
    ).rejects.toThrow('déjà terminée');

    expect(
      raw.prepare('SELECT remaining_quantity FROM medication_boxes').get(),
    ).toEqual({ remaining_quantity: 6.5 });
    expect(
      raw.prepare(`SELECT COUNT(*) AS count FROM stock_movements`).get(),
    ).toEqual({ count: 1 });
    raw.close();
  });

  it('rollback toutes les écritures si une consommation échoue en cours de transaction', async () => {
    const { raw, database } = await createDatabase(true);
    const id = seedPreparation(raw, 2);

    await expect(
      completePreparation(database, id, '2026-08-09'),
    ).rejects.toThrow('échec injecté');

    expect(
      raw.prepare('SELECT status FROM preparations WHERE id = ?').get(id),
    ).toEqual({ status: 'DRAFT' });
    expect(
      raw
        .prepare('SELECT remaining_quantity FROM medication_boxes ORDER BY id')
        .all(),
    ).toEqual([{ remaining_quantity: 10 }, { remaining_quantity: 10 }]);
    expect(
      raw.prepare(`SELECT COUNT(*) AS count FROM stock_movements`).get(),
    ).toEqual({ count: 0 });
    expect(
      raw.prepare(`SELECT COUNT(*) AS count FROM preparation_box_usages`).get(),
    ).toEqual({ count: 0 });
    raw.close();
  });
});
