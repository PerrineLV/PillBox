import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  preparationEndDate,
  type PreparationSnapshot,
} from '@/domain/preparations/preparation';

import {
  cancelPreparation,
  completePendingItem,
  completePreparation,
  createPreparation,
  getLatestDraftPreparation,
  getPendingCompletionCases,
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
       (preparation_id, specialty_cis, box_id, quantity_half_units, verification, scan_raw)
       VALUES (?, ?, ?, 7, ?, ?)`,
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

function twoMedicationSnapshot(startDate: string): PreparationSnapshot {
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
      {
        treatmentId: 2,
        specialtyCis: '60000002',
        specialtyName: 'Médicament 2',
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
      {
        specialtyCis: '60000002',
        specialtyName: 'Médicament 2',
        requiredHalfUnits: 7,
        usableStockHalfUnits: 20,
        missingHalfUnits: 0,
      },
    ],
    hasShortages: false,
  };
}

function insertBox(
  raw: Database.Database,
  overrides: {
    specialtyCis: string;
    lot: string;
    remainingQuantity?: number;
    expirationDate?: string;
  },
): number {
  return Number(
    raw
      .prepare(
        `INSERT INTO medication_boxes
       (specialty_cis, specialty_name, presentation_cip13, presentation_label,
        lot, expiration_date, initial_quantity, remaining_quantity, scan_raw)
       VALUES (?, ?, ?, 'Boîte', ?, ?, 10, ?, 'raw')`,
      )
      .run(
        overrides.specialtyCis,
        `Médicament ${overrides.specialtyCis}`,
        `34${overrides.specialtyCis}0000`,
        overrides.lot,
        overrides.expirationDate ?? '2027-01-01',
        overrides.remainingQuantity ?? 10,
      ).lastInsertRowid,
  );
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

  it('accepte une correspondance générique confirmée et la trace jusqu’à l’historique', async () => {
    const { raw, database } = await createDatabase();
    const preparationId = Number(
      raw
        .prepare(
          `INSERT INTO preparations (start_date, end_date) VALUES ('2026-08-10', '2026-08-16')`,
        )
        .run().lastInsertRowid,
    );
    raw
      .prepare(
        `INSERT INTO preparation_requirements VALUES (?, '60000001', 'Zoloft', 7, 20, 0)`,
      )
      .run(preparationId);
    const boxId = insertBox(raw, {
      specialtyCis: '60000002',
      lot: 'SERTRALINE-1',
    });
    raw
      .prepare(
        `INSERT INTO preparation_progress
         (preparation_id, specialty_cis, box_id, quantity_half_units,
          verification, scan_raw, matched_cis, matched_specialty_name)
         VALUES (?, '60000001', ?, 7, 'SCAN', 'scan', '60000002', 'Sertraline')`,
      )
      .run(preparationId, boxId);

    await completePreparation(database, preparationId, '2026-08-09');

    const history = await listPreparationHistory(database);
    expect(history[0].medications[0]).toMatchObject({
      specialtyCis: '60000001',
      specialtyName: 'Zoloft',
      matchedCis: '60000002',
      matchedSpecialtyName: 'Sertraline',
    });
    raw.close();
  });

  it('refuse la validation si la boîte ne correspond ni au CIS attendu ni au CIS confirmé', async () => {
    const { raw, database } = await createDatabase();
    const preparationId = Number(
      raw
        .prepare(
          `INSERT INTO preparations (start_date, end_date) VALUES ('2026-08-10', '2026-08-16')`,
        )
        .run().lastInsertRowid,
    );
    raw
      .prepare(
        `INSERT INTO preparation_requirements VALUES (?, '60000001', 'Zoloft', 7, 20, 0)`,
      )
      .run(preparationId);
    const boxId = insertBox(raw, {
      specialtyCis: '60000002',
      lot: 'SERTRALINE-1',
    });
    // matched_cis pointe vers un troisième CIS, différent de celui de la boîte
    // réellement liée : incohérence détectée à la validation.
    raw
      .prepare(
        `INSERT INTO preparation_progress
         (preparation_id, specialty_cis, box_id, quantity_half_units,
          verification, scan_raw, matched_cis, matched_specialty_name)
         VALUES (?, '60000001', ?, 7, 'SCAN', 'scan', '60000003', 'Autre générique')`,
      )
      .run(preparationId, boxId);

    await expect(
      completePreparation(database, preparationId, '2026-08-09'),
    ).rejects.toThrow('ne correspond plus au médicament attendu');
    raw.close();
  });

  it('refuse de sauvegarder une correspondance générique identique au CIS attendu', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);
    await expect(
      savePreparationProgress(database, id, {
        specialtyCis: '60000001',
        boxId: 1,
        quantityHalfUnits: 7,
        verification: 'SCAN',
        scanRaw: 'scan',
        nonFefoAcknowledged: false,
        matchedCis: '60000001',
        matchedSpecialtyName: 'Médicament 1',
      }),
    ).rejects.toThrow('correspondance exacte');
    raw.close();
  });

  it('refuse une correspondance générique incomplète (CIS sans nom ou l’inverse)', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);
    await expect(
      savePreparationProgress(database, id, {
        specialtyCis: '60000001',
        boxId: 1,
        quantityHalfUnits: 7,
        verification: 'SCAN',
        scanRaw: 'scan',
        nonFefoAcknowledged: false,
        matchedCis: '60000002',
        matchedSpecialtyName: null,
      }),
    ).rejects.toThrow('ensemble');
    raw.close();
  });

  it('refuse d’enregistrer une vérification par scan sans chaîne brute', async () => {
    const { raw, database } = await createDatabase();
    const id = seedPreparation(raw);

    await expect(
      savePreparationProgress(database, id, {
        specialtyCis: '60000001',
        boxId: 1,
        quantityHalfUnits: 7,
        verification: 'SCAN',
        scanRaw: null,
        nonFefoAcknowledged: false,
        matchedCis: null,
        matchedSpecialtyName: null,
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
      quantityHalfUnits: 7,
      verification: 'MANUAL',
      scanRaw: null,
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
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

describe('reprise d’une préparation après fermeture de l’application', () => {
  it('retrouve exactement la progression déjà enregistrée et le médicament restant', async () => {
    const { raw, database } = await createDatabase();
    const id = await createPreparation(
      database,
      twoMedicationSnapshot('2026-08-17'),
    );
    const firstBoxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'LOT-1',
    });

    await savePreparationProgress(database, id, {
      specialtyCis: '60000001',
      boxId: firstBoxId,
      quantityHalfUnits: 7,
      verification: 'SCAN',
      scanRaw: 'raw',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });

    // Simule une fermeture puis réouverture de l’app : tout est relu depuis
    // la base locale plutôt que depuis un état en mémoire.
    const reopened = await getLatestDraftPreparation(database);
    expect(reopened?.id).toBe(id);
    expect(reopened?.snapshot.requirements).toHaveLength(2);
    expect(reopened?.progress).toHaveLength(1);
    expect(reopened?.progress[0]).toMatchObject({
      specialtyCis: '60000001',
      boxId: firstBoxId,
      verification: 'SCAN',
    });
    raw.close();
  });

  it('reprend une préparation entièrement vérifiée sans médicament restant', async () => {
    const { raw, database } = await createDatabase();
    const id = await createPreparation(
      database,
      twoMedicationSnapshot('2026-08-17'),
    );
    const firstBoxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'LOT-1',
    });
    const secondBoxId = insertBox(raw, {
      specialtyCis: '60000002',
      lot: 'LOT-2',
    });
    await savePreparationProgress(database, id, {
      specialtyCis: '60000001',
      boxId: firstBoxId,
      quantityHalfUnits: 7,
      verification: 'SCAN',
      scanRaw: 'raw',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });
    await savePreparationProgress(database, id, {
      specialtyCis: '60000002',
      boxId: secondBoxId,
      quantityHalfUnits: 7,
      verification: 'MANUAL',
      scanRaw: null,
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });

    const reopened = await getLatestDraftPreparation(database);
    expect(reopened?.progress).toHaveLength(2);
    raw.close();
  });
});

describe('fin d’une boîte et relais par une seconde pour un même médicament', () => {
  it('couvre le besoin par deux boîtes distinctes et décrémente chacune exactement', async () => {
    const { raw, database } = await createDatabase();
    const id = await createPreparation(
      database,
      twoMedicationSnapshot('2026-08-17'),
    );
    // Besoin de 7 demi-unités pour 60000001 (twoMedicationSnapshot) : la
    // première boîte n'en couvre qu'une partie, la seconde complète le reste.
    const almostEmptyBoxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'PRESQUE-VIDE',
      remainingQuantity: 1,
    });
    const freshBoxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'FRAICHE',
      remainingQuantity: 10,
    });
    const otherBoxId = insertBox(raw, {
      specialtyCis: '60000002',
      lot: 'LOT-2',
    });

    await savePreparationProgress(database, id, {
      specialtyCis: '60000001',
      boxId: almostEmptyBoxId,
      quantityHalfUnits: 2,
      verification: 'SCAN',
      scanRaw: 'raw-1',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });
    await savePreparationProgress(database, id, {
      specialtyCis: '60000001',
      boxId: freshBoxId,
      quantityHalfUnits: 5,
      verification: 'SCAN',
      scanRaw: 'raw-2',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });
    await savePreparationProgress(database, id, {
      specialtyCis: '60000002',
      boxId: otherBoxId,
      quantityHalfUnits: 7,
      verification: 'SCAN',
      scanRaw: 'raw-3',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });

    // Reprise après fermeture : les deux contributions du même médicament
    // doivent toutes deux être retrouvées, sans que l'une efface l'autre.
    const reopened = await getLatestDraftPreparation(database);
    expect(
      reopened?.progress.filter((item) => item.specialtyCis === '60000001'),
    ).toHaveLength(2);

    await completePreparation(database, id, '2026-08-16');

    expect(
      raw
        .prepare('SELECT remaining_quantity FROM medication_boxes WHERE id = ?')
        .get(almostEmptyBoxId),
    ).toEqual({ remaining_quantity: 0 });
    expect(
      raw
        .prepare('SELECT remaining_quantity FROM medication_boxes WHERE id = ?')
        .get(freshBoxId),
    ).toEqual({ remaining_quantity: 7.5 });
    expect(
      raw
        .prepare('SELECT remaining_quantity FROM medication_boxes WHERE id = ?')
        .get(otherBoxId),
    ).toEqual({ remaining_quantity: 6.5 });

    const usedBoxIds = (
      raw
        .prepare('SELECT box_id FROM preparation_box_usages ORDER BY box_id')
        .all() as { box_id: number }[]
    ).map((row) => row.box_id);
    expect(usedBoxIds).toEqual(
      [almostEmptyBoxId, freshBoxId, otherBoxId].sort((a, b) => a - b),
    );

    const history = await listPreparationHistory(database);
    const medication1Usages = history[0].medications.filter(
      (item) => item.specialtyCis === '60000001',
    );
    expect(medication1Usages).toHaveLength(2);
    expect(
      medication1Usages.reduce((sum, item) => sum + item.quantityHalfUnits, 0),
    ).toBe(7);
    raw.close();
  });

  it('refuse la validation si les contributions ne couvrent pas exactement le besoin', async () => {
    const { raw, database } = await createDatabase();
    const id = await createPreparation(
      database,
      twoMedicationSnapshot('2026-08-17'),
    );
    const boxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'INCOMPLETE',
      remainingQuantity: 10,
    });
    const otherBoxId = insertBox(raw, {
      specialtyCis: '60000002',
      lot: 'LOT-2',
    });
    // Contribution volontairement insuffisante (2 sur 7 nécessaires), comme
    // si l'écran avait laissé passer une boîte partielle sans en ajouter une
    // seconde : la transaction doit refuser plutôt que sous-décrémenter.
    await savePreparationProgress(database, id, {
      specialtyCis: '60000001',
      boxId,
      quantityHalfUnits: 2,
      verification: 'SCAN',
      scanRaw: 'raw-1',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });
    await savePreparationProgress(database, id, {
      specialtyCis: '60000002',
      boxId: otherBoxId,
      quantityHalfUnits: 7,
      verification: 'SCAN',
      scanRaw: 'raw-2',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });

    await expect(
      completePreparation(database, id, '2026-08-16'),
    ).rejects.toThrow('ne couvre pas exactement');
    expect(
      raw.prepare('SELECT status FROM preparations WHERE id = ?').get(id),
    ).toEqual({ status: 'DRAFT' });
    expect(
      raw.prepare('SELECT COUNT(*) AS count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
    raw.close();
  });
});

describe('délivrance encadrée : validation partielle (ticket 30b)', () => {
  function insertControlledDispensingTreatment(
    raw: Database.Database,
    id: number,
    cis: string,
    theoreticalRenewalDate: string | null,
  ): void {
    // Ligne d'ordonnance en mode FRACTIONAL (ticket 45), remplace l'ancien
    // `treatments.controlled_dispensing_enabled = 1`.
    raw
      .prepare(
        `INSERT INTO treatments (id, specialty_cis, specialty_name) VALUES (?, ?, ?)`,
      )
      .run(id, cis, `Médicament ${cis}`);
    const prescriptionId = Number(
      raw
        .prepare(
          `INSERT INTO prescriptions (label, issue_date, valid_until)
           VALUES ('Ordo', '2026-08-01', '2026-12-01')`,
        )
        .run().lastInsertRowid,
    );
    raw
      .prepare(
        `INSERT INTO prescription_items
         (prescription_id, treatment_id, quantity_kind, duration_days,
          dispensing_mode, periodicity_days, theoretical_renewal_date)
         VALUES (?, ?, 'DURATION', 28, 'FRACTIONAL', 28, ?)`,
      )
      .run(prescriptionId, id, theoreticalRenewalDate);
  }

  function threeDaySnapshot(
    startDate: string,
    treatmentId: number,
    cis: string,
  ): PreparationSnapshot {
    const dates = ['2026-08-17', '2026-08-18', '2026-08-19'];
    return {
      startDate,
      endDate: preparationEndDate(startDate),
      items: dates.map((date) => ({
        treatmentId,
        specialtyCis: cis,
        specialtyName: `Médicament ${cis}`,
        pharmaceuticalForm: 'comprimé',
        date,
        slot: 'morning' as const,
        quantityHalfUnits: 2,
      })),
      requirements: [
        {
          specialtyCis: cis,
          specialtyName: `Médicament ${cis}`,
          requiredHalfUnits: 6,
          usableStockHalfUnits: 2,
          missingHalfUnits: 4,
        },
      ],
      hasShortages: true,
    };
  }

  it('valide malgré une rupture pour un traitement à délivrance encadrée, sans bloquer les autres médicaments', async () => {
    const { raw, database } = await createDatabase();
    insertControlledDispensingTreatment(raw, 1, '60000001', '2026-08-25');
    const id = await createPreparation(
      database,
      threeDaySnapshot('2026-08-17', 1, '60000001'),
    );
    // Autre médicament, sans délivrance encadrée : doit rester couvert
    // exactement, comme aujourd'hui (ticket 11).
    raw
      .prepare(
        `INSERT INTO preparation_requirements
         (preparation_id, specialty_cis, specialty_name, required_half_units,
          usable_stock_half_units, missing_half_units)
         VALUES (?, '60000002', 'Médicament 60000002', 7, 20, 0)`,
      )
      .run(id);
    raw
      .prepare(
        `INSERT INTO preparation_items
         (preparation_id, source_treatment_id, specialty_cis, specialty_name,
          pharmaceutical_form, intake_date, slot, quantity_half_units)
         VALUES (?, 2, '60000002', 'Médicament 60000002', 'comprimé', '2026-08-17', 'morning', 7)`,
      )
      .run(id);
    const shortBoxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'COURT',
      remainingQuantity: 1,
    });
    const otherBoxId = insertBox(raw, {
      specialtyCis: '60000002',
      lot: 'COMPLET',
    });
    await savePreparationProgress(database, id, {
      specialtyCis: '60000001',
      boxId: shortBoxId,
      quantityHalfUnits: 2,
      verification: 'SCAN',
      scanRaw: 'raw-court',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });
    await savePreparationProgress(database, id, {
      specialtyCis: '60000002',
      boxId: otherBoxId,
      quantityHalfUnits: 7,
      verification: 'SCAN',
      scanRaw: 'raw-complet',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });

    const pending = await completePreparation(database, id, '2026-08-16');

    expect(pending).toEqual(['60000001']);
    expect(
      raw.prepare('SELECT status FROM preparations WHERE id = ?').get(id),
    ).toEqual({ status: 'COMPLETED' });
    const items = raw
      .prepare(
        `SELECT intake_date, completion_status FROM preparation_items
         WHERE preparation_id = ? AND specialty_cis = '60000001' ORDER BY intake_date`,
      )
      .all(id);
    expect(items).toEqual([
      { intake_date: '2026-08-17', completion_status: 'FILLED' },
      { intake_date: '2026-08-18', completion_status: 'PENDING_COMPLEMENT' },
      { intake_date: '2026-08-19', completion_status: 'PENDING_COMPLEMENT' },
    ]);
    // Le médicament non concerné par la délivrance encadrée n'a aucun statut :
    // son état ne relève pas de ce dispositif.
    expect(
      raw
        .prepare(
          `SELECT completion_status FROM preparation_items WHERE specialty_cis = '60000002'`,
        )
        .get(),
    ).toEqual({ completion_status: null });
    raw.close();
  });

  it('accepte une couverture nulle (aucune boîte disponible) pour un traitement à délivrance encadrée', async () => {
    const { raw, database } = await createDatabase();
    insertControlledDispensingTreatment(raw, 1, '60000001', null);
    const id = await createPreparation(
      database,
      threeDaySnapshot('2026-08-17', 1, '60000001'),
    );

    const pending = await completePreparation(database, id, '2026-08-16');

    expect(pending).toEqual(['60000001']);
    expect(
      raw
        .prepare(
          `SELECT completion_status FROM preparation_items WHERE preparation_id = ?`,
        )
        .all(id),
    ).toEqual([
      { completion_status: 'PENDING_COMPLEMENT' },
      { completion_status: 'PENDING_COMPLEMENT' },
      { completion_status: 'PENDING_COMPLEMENT' },
    ]);
    raw.close();
  });

  it('rejette une couverture supérieure au besoin même pour un traitement à délivrance encadrée', async () => {
    const { raw, database } = await createDatabase();
    insertControlledDispensingTreatment(raw, 1, '60000001', null);
    const id = await createPreparation(
      database,
      threeDaySnapshot('2026-08-17', 1, '60000001'),
    );
    const boxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'TROP',
      remainingQuantity: 10,
    });
    await savePreparationProgress(database, id, {
      specialtyCis: '60000001',
      boxId,
      quantityHalfUnits: 8,
      verification: 'SCAN',
      scanRaw: 'raw-trop',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });

    await expect(
      completePreparation(database, id, '2026-08-16'),
    ).rejects.toThrow('dépasse le besoin');
    raw.close();
  });

  it('couvre entièrement le médicament et ne signale aucune case en attente', async () => {
    const { raw, database } = await createDatabase();
    insertControlledDispensingTreatment(raw, 1, '60000001', null);
    const id = await createPreparation(
      database,
      threeDaySnapshot('2026-08-17', 1, '60000001'),
    );
    const boxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'COMPLET',
      remainingQuantity: 10,
    });
    await savePreparationProgress(database, id, {
      specialtyCis: '60000001',
      boxId,
      quantityHalfUnits: 6,
      verification: 'SCAN',
      scanRaw: 'raw-complet',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });

    const pending = await completePreparation(database, id, '2026-08-16');

    expect(pending).toEqual([]);
    expect(
      raw
        .prepare(
          `SELECT completion_status FROM preparation_items WHERE preparation_id = ?`,
        )
        .all(id),
    ).toEqual([
      { completion_status: 'FILLED' },
      { completion_status: 'FILLED' },
      { completion_status: 'FILLED' },
    ]);
    raw.close();
  });
});

describe('complément ultérieur d’une case en attente (ticket 30b)', () => {
  function insertControlledDispensingTreatment(
    raw: Database.Database,
    id: number,
    cis: string,
    theoreticalRenewalDate: string | null,
  ): void {
    // Ligne d'ordonnance en mode FRACTIONAL (ticket 45), remplace l'ancien
    // `treatments.controlled_dispensing_enabled = 1`.
    raw
      .prepare(
        `INSERT INTO treatments (id, specialty_cis, specialty_name) VALUES (?, ?, ?)`,
      )
      .run(id, cis, `Médicament ${cis}`);
    const prescriptionId = Number(
      raw
        .prepare(
          `INSERT INTO prescriptions (label, issue_date, valid_until)
           VALUES ('Ordo', '2026-08-01', '2026-12-01')`,
        )
        .run().lastInsertRowid,
    );
    raw
      .prepare(
        `INSERT INTO prescription_items
         (prescription_id, treatment_id, quantity_kind, duration_days,
          dispensing_mode, periodicity_days, theoretical_renewal_date)
         VALUES (?, ?, 'DURATION', 28, 'FRACTIONAL', 28, ?)`,
      )
      .run(prescriptionId, id, theoreticalRenewalDate);
  }

  function threeDaySnapshot(
    startDate: string,
    treatmentId: number,
    cis: string,
  ): PreparationSnapshot {
    const dates = ['2026-08-17', '2026-08-18', '2026-08-19'];
    return {
      startDate,
      endDate: preparationEndDate(startDate),
      items: dates.map((date) => ({
        treatmentId,
        specialtyCis: cis,
        specialtyName: `Médicament ${cis}`,
        pharmaceuticalForm: 'comprimé',
        date,
        slot: 'morning' as const,
        quantityHalfUnits: 2,
      })),
      requirements: [
        {
          specialtyCis: cis,
          specialtyName: `Médicament ${cis}`,
          requiredHalfUnits: 6,
          usableStockHalfUnits: 0,
          missingHalfUnits: 6,
        },
      ],
      hasShortages: true,
    };
  }

  async function seedFullyPendingPreparation(): Promise<{
    raw: Database.Database;
    database: SQLiteDatabase;
    id: number;
  }> {
    const { raw, database } = await createDatabase();
    insertControlledDispensingTreatment(raw, 1, '60000001', '2026-08-25');
    const id = await createPreparation(
      database,
      threeDaySnapshot('2026-08-17', 1, '60000001'),
    );
    await completePreparation(database, id, '2026-08-16');
    return { raw, database, id };
  }

  it('liste les cases en attente avec la date théorique du traitement', async () => {
    const { raw, database, id } = await seedFullyPendingPreparation();

    const cases = await getPendingCompletionCases(database);

    expect(cases).toEqual([
      {
        preparationId: id,
        preparationStartDate: '2026-08-17',
        preparationEndDate: '2026-08-23',
        specialtyCis: '60000001',
        specialtyName: 'Médicament 60000001',
        treatmentId: 1,
        pendingItems: [
          { date: '2026-08-17', slot: 'morning' },
          { date: '2026-08-18', slot: 'morning' },
          { date: '2026-08-19', slot: 'morning' },
        ],
        pendingHalfUnits: 6,
        theoreticalRenewalDate: '2026-08-25',
      },
    ]);
    raw.close();
  });

  it('n’affiche aucune date théorique quand elle n’est pas renseignée', async () => {
    const { raw, database } = await createDatabase();
    insertControlledDispensingTreatment(raw, 1, '60000001', null);
    await createPreparation(
      database,
      threeDaySnapshot('2026-08-17', 1, '60000001'),
    ).then((id) => completePreparation(database, id, '2026-08-16'));

    const [pending] = await getPendingCompletionCases(database);

    expect(pending.theoreticalRenewalDate).toBeNull();
    raw.close();
  });

  it('complète partiellement une case en attente sans reprendre tout le flux', async () => {
    const { raw, database, id } = await seedFullyPendingPreparation();
    const boxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'COMPLEMENT-1',
      remainingQuantity: 2,
    });

    const resolved = await completePendingItem(
      database,
      id,
      '60000001',
      {
        boxId,
        quantityHalfUnits: 2,
        verification: 'SCAN',
        scanRaw: 'raw-complement',
        matchedCis: null,
        matchedSpecialtyName: null,
      },
      '2026-08-18',
    );

    expect(resolved).toBe(false);
    expect(
      raw.prepare('SELECT remaining_quantity FROM medication_boxes').get(),
    ).toEqual({ remaining_quantity: 1 });
    const items = raw
      .prepare(
        `SELECT intake_date, completion_status FROM preparation_items
         WHERE preparation_id = ? ORDER BY intake_date`,
      )
      .all(id);
    expect(items).toEqual([
      { intake_date: '2026-08-17', completion_status: 'FILLED' },
      { intake_date: '2026-08-18', completion_status: 'PENDING_COMPLEMENT' },
      { intake_date: '2026-08-19', completion_status: 'PENDING_COMPLEMENT' },
    ]);
    const remainingPending = await getPendingCompletionCases(database);
    expect(remainingPending[0].pendingHalfUnits).toBe(4);
    raw.close();
  });

  it('résout entièrement la case quand la couverture atteint le reste en attente', async () => {
    const { raw, database, id } = await seedFullyPendingPreparation();
    const boxId = insertBox(raw, {
      specialtyCis: '60000001',
      lot: 'COMPLEMENT-TOTAL',
      remainingQuantity: 3,
    });

    const resolved = await completePendingItem(
      database,
      id,
      '60000001',
      {
        boxId,
        quantityHalfUnits: 6,
        verification: 'MANUAL',
        scanRaw: null,
        matchedCis: null,
        matchedSpecialtyName: null,
      },
      '2026-08-18',
    );

    expect(resolved).toBe(true);
    expect(await getPendingCompletionCases(database)).toEqual([]);
    const history = await listPreparationHistory(database);
    expect(
      history[0].medications.find((item) => item.boxId === boxId),
    ).toMatchObject({ quantityHalfUnits: 6, verification: 'MANUAL' });
    raw.close();
  });

  it('refuse une boîte d’un autre médicament', async () => {
    const { raw, database, id } = await seedFullyPendingPreparation();
    const boxId = insertBox(raw, {
      specialtyCis: '60000009',
      lot: 'AUTRE',
      remainingQuantity: 5,
    });

    await expect(
      completePendingItem(
        database,
        id,
        '60000001',
        {
          boxId,
          quantityHalfUnits: 2,
          verification: 'SCAN',
          scanRaw: 'raw',
          matchedCis: null,
          matchedSpecialtyName: null,
        },
        '2026-08-18',
      ),
    ).rejects.toThrow('ne correspond pas au médicament attendu');
    raw.close();
  });

  it('refuse de compléter un médicament sans case en attente', async () => {
    const { raw, database, id } = await seedFullyPendingPreparation();
    const boxId = insertBox(raw, {
      specialtyCis: '60000002',
      lot: 'SANS-ATTENTE',
    });

    await expect(
      completePendingItem(
        database,
        id,
        '60000002',
        {
          boxId,
          quantityHalfUnits: 2,
          verification: 'SCAN',
          scanRaw: 'raw',
          matchedCis: null,
          matchedSpecialtyName: null,
        },
        '2026-08-18',
      ),
    ).rejects.toThrow('Aucune case en attente');
    raw.close();
  });
});

describe('plusieurs préparations se succèdent sans interférence', () => {
  it('conserve un historique distinct et un stock correct pour chaque semaine validée', async () => {
    const { raw, database } = await createDatabase();

    const firstId = seedPreparation(raw);
    await completePreparation(database, firstId, '2026-08-09');

    const boxId = insertBox(raw, { specialtyCis: '60000001', lot: 'LOT-2' });
    const secondId = await createPreparation(
      database,
      weekSnapshot('2026-08-17'),
    );
    await savePreparationProgress(database, secondId, {
      specialtyCis: '60000001',
      boxId,
      quantityHalfUnits: 7,
      verification: 'SCAN',
      scanRaw: 'raw-semaine-2',
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });
    await completePreparation(database, secondId, '2026-08-16');

    expect(firstId).not.toBe(secondId);
    const history = await listPreparationHistory(database);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.startDate).sort()).toEqual([
      '2026-08-10',
      '2026-08-17',
    ]);
    // Le mouvement de la seconde semaine ne touche que sa propre boîte : la
    // boîte de la première semaine n'est jamais redécrémentée.
    expect(
      raw
        .prepare('SELECT remaining_quantity FROM medication_boxes ORDER BY id')
        .all(),
    ).toEqual([{ remaining_quantity: 6.5 }, { remaining_quantity: 6.5 }]);
    expect(
      raw.prepare('SELECT COUNT(*) AS count FROM stock_movements').get(),
    ).toEqual({ count: 2 });
    raw.close();
  });
});
