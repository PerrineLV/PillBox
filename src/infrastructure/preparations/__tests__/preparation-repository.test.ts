import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';

import {
  completePreparation,
  listPreparationHistory,
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

function seedPreparation(raw: Database.Database, medicationCount = 1): number {
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
       (preparation_id, specialty_cis, box_id, scan_raw)
       VALUES (?, ?, ?, 'scan')`,
      )
      .run(preparationId, cis, boxId);
  }
  return preparationId;
}

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
