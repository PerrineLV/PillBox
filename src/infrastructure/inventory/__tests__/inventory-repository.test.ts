import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { usableQuantity } from '@/domain/inventory/inventory';
import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  preparationEndDate,
  type PreparationSnapshot,
} from '@/domain/preparations/preparation';
import {
  completePreparation,
  createPreparation,
  savePreparationProgress,
} from '@/infrastructure/preparations/preparation-repository';

import {
  addMedicationBox,
  deleteUnusedMedicationBox,
  getMedicationBoxRemovalAction,
  listMedicationBoxes,
  listStockMovements,
} from '../inventory-repository';

type SqlParameters = readonly (string | number | null)[];

function adapter(raw: Database.Database): SQLiteDatabase {
  const api = {
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

async function createDatabase() {
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
  return { raw, database: adapter(raw) };
}

const manualDraft = {
  specialtyCis: '60000001',
  specialtyName: 'Alpha',
  pharmaceuticalForm: 'comprimé',
  presentationCip13: '3400000000001',
  presentationLabel: 'Boîte de 30',
  lot: 'LOT-MANUEL',
  expirationDate: '2027-12-31',
  initialQuantity: 30,
  origin: 'MANUAL',
  scanRaw: null,
} as const;

describe('ajout d’une boîte au stock local', () => {
  it('enregistre une boîte sans DataMatrix et la rend utilisable', async () => {
    const { raw, database } = await createDatabase();

    const id = await addMedicationBox(database, manualDraft);

    const boxes = await listMedicationBoxes(database);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({
      id,
      lot: 'LOT-MANUEL',
      origin: 'MANUAL',
      scanRaw: null,
      remainingQuantity: 30,
    });
    expect(usableQuantity(boxes[0], '2026-08-10')).toBe(30);
    expect(
      raw.prepare('SELECT type, explanation FROM stock_movements').get(),
    ).toEqual({
      type: 'BOX_ADDED',
      explanation: 'Ajout manuel de la boîte au stock',
    });
    raw.close();
  });

  it('conserve la chaîne brute et l’origine d’une boîte scannée', async () => {
    const { raw, database } = await createDatabase();

    await addMedicationBox(database, {
      ...manualDraft,
      lot: 'LOT-SCAN',
      origin: 'SCAN',
      scanRaw: ']d20134000000000011727123110LOT-SCAN',
    });

    const boxes = await listMedicationBoxes(database);
    expect(boxes[0]).toMatchObject({
      origin: 'SCAN',
      scanRaw: ']d20134000000000011727123110LOT-SCAN',
    });
    raw.close();
  });

  it('n’écrit rien lorsqu’une boîte manuelle est incomplète', async () => {
    const { raw, database } = await createDatabase();

    await expect(
      addMedicationBox(database, { ...manualDraft, initialQuantity: 0 }),
    ).rejects.toThrow('quantité initiale');
    await expect(
      addMedicationBox(database, { ...manualDraft, expirationDate: '' }),
    ).rejects.toThrow('AAAA-MM-JJ');
    await expect(
      addMedicationBox(database, { ...manualDraft, lot: '' }),
    ).rejects.toThrow('lot est requis');

    expect(await listMedicationBoxes(database)).toEqual([]);
    expect(
      raw.prepare('SELECT COUNT(*) AS count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
    raw.close();
  });

  it('lit les boîtes déjà scannées avant l’ajout manuel comme des boîtes scannées', async () => {
    const { raw, database } = await createDatabase();
    raw
      .prepare(
        `INSERT INTO medication_boxes
         (specialty_cis, specialty_name, presentation_cip13, presentation_label,
          lot, serial_number, expiration_date, initial_quantity, remaining_quantity, scan_raw)
         VALUES ('60000001', 'Alpha', '3400000000001', 'Boîte de 30',
                 'LOT-ANCIEN', 'SERIE-9', '2027-12-31', 30, 12, 'raw-historique')`,
      )
      .run();

    const boxes = await listMedicationBoxes(database);

    expect(boxes[0]).toMatchObject({
      lot: 'LOT-ANCIEN',
      origin: 'SCAN',
      scanRaw: 'raw-historique',
      remainingQuantity: 12,
    });
    raw.close();
  });
});

/** Snapshot minimal portant sur la spécialité de `manualDraft`. */
function weekSnapshot(startDate: string): PreparationSnapshot {
  return {
    startDate,
    endDate: preparationEndDate(startDate),
    items: [
      {
        treatmentId: 1,
        specialtyCis: manualDraft.specialtyCis,
        specialtyName: manualDraft.specialtyName,
        pharmaceuticalForm: manualDraft.pharmaceuticalForm,
        date: startDate,
        slot: 'morning',
        quantityHalfUnits: 1,
      },
    ],
    requirements: [
      {
        specialtyCis: manualDraft.specialtyCis,
        specialtyName: manualDraft.specialtyName,
        requiredHalfUnits: 7,
        usableStockHalfUnits: 60,
        missingHalfUnits: 0,
      },
    ],
    hasShortages: false,
  };
}

describe('suppression d’une boîte du stock', () => {
  it('supprime une boîte jamais utilisée ainsi que ses mouvements de stock', async () => {
    const { raw, database } = await createDatabase();
    const id = await addMedicationBox(database, manualDraft);

    expect(await getMedicationBoxRemovalAction(database, id)).toBe('DELETE');
    await deleteUnusedMedicationBox(database, id);

    expect(await listMedicationBoxes(database)).toEqual([]);
    expect(await listStockMovements(database, id)).toEqual([]);
    raw.close();
  });

  it('refuse de supprimer une boîte consommée par une préparation validée et oriente vers l’ajustement', async () => {
    const { raw, database } = await createDatabase();
    const id = await addMedicationBox(database, manualDraft);
    const preparationId = await createPreparation(
      database,
      weekSnapshot('2026-08-10'),
    );
    await savePreparationProgress(database, preparationId, {
      specialtyCis: manualDraft.specialtyCis,
      boxId: id,
      quantityHalfUnits: 7,
      verification: 'MANUAL',
      scanRaw: null,
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });
    await completePreparation(database, preparationId, '2026-08-10');

    expect(await getMedicationBoxRemovalAction(database, id)).toBe(
      'KEEP_USED_IN_PREPARATION',
    );
    await expect(deleteUnusedMedicationBox(database, id)).rejects.toThrow(
      'ajustez sa quantité restante à 0',
    );

    expect(await listMedicationBoxes(database)).toHaveLength(1);
    expect(await listStockMovements(database, id)).toHaveLength(2);
    raw.close();
  });

  it('refuse de supprimer une boîte désignée par une préparation en cours', async () => {
    const { raw, database } = await createDatabase();
    const id = await addMedicationBox(database, manualDraft);
    const preparationId = await createPreparation(
      database,
      weekSnapshot('2026-08-10'),
    );
    await savePreparationProgress(database, preparationId, {
      specialtyCis: manualDraft.specialtyCis,
      boxId: id,
      quantityHalfUnits: 7,
      verification: 'MANUAL',
      scanRaw: null,
      nonFefoAcknowledged: false,
      matchedCis: null,
      matchedSpecialtyName: null,
    });

    expect(await getMedicationBoxRemovalAction(database, id)).toBe(
      'KEEP_IN_DRAFT_PREPARATION',
    );
    await expect(deleteUnusedMedicationBox(database, id)).rejects.toThrow(
      'préparation en cours',
    );

    expect(await listMedicationBoxes(database)).toHaveLength(1);
    raw.close();
  });

  it('refuse de supprimer une boîte introuvable', async () => {
    const { raw, database } = await createDatabase();

    await expect(deleteUnusedMedicationBox(database, 404)).rejects.toThrow(
      'Boîte introuvable.',
    );
    raw.close();
  });
});
