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
