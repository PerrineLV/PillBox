import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import {
  materializeIntakeSnapshots,
  takeOutsidePillboxIntake,
} from '@/infrastructure/intakes/intake-repository';
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
  adjustMedicationBox,
  deleteUnusedMedicationBox,
  discardExpiredMedicationBox,
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

describe('ajustement du stock final', () => {
  it('conserve les demi-unités et ne crée qu’un mouvement pour une valeur répétée', async () => {
    const { raw, database } = await createDatabase();
    try {
      const id = await addMedicationBox(database, manualDraft);
      for (const quantity of [90, 90, 2.5, 0]) {
        await adjustMedicationBox(
          database,
          id,
          quantity,
          'MANUAL_ADJUSTMENT',
          'Comptage',
        );
      }
      expect((await listMedicationBoxes(database))[0].remainingQuantity).toBe(
        0,
      );
      const movements = (await listStockMovements(database, id)).filter(
        (m) => m.type === 'MANUAL_ADJUSTMENT',
      );
      expect(movements).toHaveLength(3);
      expect(movements.map((m) => [m.quantityDelta, m.quantityAfter])).toEqual(
        expect.arrayContaining([
          [60, 90],
          [-87.5, 2.5],
          [-2.5, 0],
        ]),
      );
      for (const quantity of [
        -1,
        0.25,
        NaN,
        Infinity,
        Number.MAX_SAFE_INTEGER,
      ]) {
        await expect(
          adjustMedicationBox(
            database,
            id,
            quantity,
            'MANUAL_ADJUSTMENT',
            'Comptage',
          ),
        ).rejects.toThrow();
      }
      expect(await listStockMovements(database, id)).toHaveLength(4);
    } finally {
      raw.close();
    }
  });
});

describe('ajout d’une boîte au stock local', () => {
  it('conserve une boîte Compl’Alim sans CIP, avec son lot et sa provenance', async () => {
    const { raw, database } = await createDatabase();
    try {
      const id = await addMedicationBox(database, {
        ...manualDraft,
        specialtyCis: 'COMPL_ALIM:123',
        specialtyName: 'Complément déclaré',
        productSource: 'COMPL_ALIM',
        presentationCip13: '',
      });
      expect(await listMedicationBoxes(database)).toEqual([
        expect.objectContaining({
          id,
          specialtyCis: 'COMPL_ALIM:123',
          productSource: 'COMPL_ALIM',
          presentationCip13: '',
          lot: 'LOT-MANUEL',
          remainingQuantity: 30,
        }),
      ]);
      expect(
        raw
          .prepare('SELECT type FROM stock_movements WHERE box_id = ?')
          .get(id),
      ).toEqual({ type: 'BOX_ADDED' });
    } finally {
      raw.close();
    }
  });

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

describe('déstockage pour péremption', () => {
  it.each([30, 12, 2.5, 0])(
    'retire le restant %s une seule fois en conservant la boîte et les mouvements',
    async (remaining) => {
      const { raw, database } = await createDatabase();
      try {
        const id = await addMedicationBox(database, manualDraft);
        await adjustMedicationBox(
          database,
          id,
          remaining,
          'MANUAL_ADJUSTMENT',
          'Comptage',
        );
        const before = await listStockMovements(database, id);
        await discardExpiredMedicationBox(
          database,
          id,
          remaining,
          '2028-01-01',
        );
        await discardExpiredMedicationBox(
          database,
          id,
          remaining,
          '2028-01-01',
        );
        expect((await listMedicationBoxes(database))[0]).toMatchObject({
          id,
          remainingQuantity: 0,
          initialQuantity: 30,
          lot: manualDraft.lot,
          expirationDate: manualDraft.expirationDate,
        });
        const after = await listStockMovements(database, id);
        expect(after).toHaveLength(before.length + (remaining > 0 ? 1 : 0));
        expect(after.slice(remaining > 0 ? 1 : 0)).toEqual(before);
        if (remaining > 0)
          expect(after[0]).toMatchObject({
            type: 'MANUAL_ADJUSTMENT',
            quantityDelta: -remaining,
            quantityAfter: 0,
            explanation: 'Déstockage de la quantité restante pour péremption',
          });
      } finally {
        raw.close();
      }
    },
  );

  it.each(['2027-12-30', '2027-12-31'])(
    'refuse une boîte non périmée au %s',
    async (today) => {
      const { raw, database } = await createDatabase();
      try {
        const id = await addMedicationBox(database, manualDraft);
        await expect(
          discardExpiredMedicationBox(database, id, 30, today),
        ).rejects.toThrow('pas périmée');
        expect((await listMedicationBoxes(database))[0].remainingQuantity).toBe(
          30,
        );
        expect(await listStockMovements(database, id)).toHaveLength(1);
      } finally {
        raw.close();
      }
    },
  );

  it('refuse une boîte absente ou un restant modifié depuis la confirmation', async () => {
    const { raw, database } = await createDatabase();
    try {
      await expect(
        discardExpiredMedicationBox(database, 999, 30, '2028-01-01'),
      ).rejects.toThrow('introuvable');
      const id = await addMedicationBox(database, manualDraft);
      await adjustMedicationBox(
        database,
        id,
        2.5,
        'MANUAL_ADJUSTMENT',
        'Comptage',
      );
      await expect(
        discardExpiredMedicationBox(database, id, 30, '2028-01-01'),
      ).rejects.toThrow('stock a changé');
      expect((await listMedicationBoxes(database))[0].remainingQuantity).toBe(
        2.5,
      );
      expect(await listStockMovements(database, id)).toHaveLength(2);
    } finally {
      raw.close();
    }
  });

  it('annule le retrait si le mouvement ne peut pas être écrit', async () => {
    const { raw, database } = await createDatabase();
    try {
      const id = await addMedicationBox(database, manualDraft);
      raw.exec(`CREATE TRIGGER fail_discard BEFORE INSERT ON stock_movements
        BEGIN SELECT RAISE(ABORT, 'écriture impossible'); END`);
      await expect(
        discardExpiredMedicationBox(database, id, 30, '2028-01-01'),
      ).rejects.toMatchObject({ message: 'écriture impossible' });
      expect((await listMedicationBoxes(database))[0].remainingQuantity).toBe(
        30,
      );
      expect(await listStockMovements(database, id)).toHaveLength(1);
    } finally {
      raw.close();
    }
  });

  it.each([true, false])(
    'préserve les usages et bloque une préparation déstockée (déjà validée : %s)',
    async (completed) => {
      const { raw, database } = await createDatabase();
      try {
        const id = await addMedicationBox(database, manualDraft);
        const preparationId = await createPreparation(
          database,
          weekSnapshot('2027-12-30'),
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
        if (completed)
          await completePreparation(database, preparationId, '2027-12-30');
        const usagesBefore = raw
          .prepare('SELECT * FROM preparation_box_usages')
          .all();
        const progressBefore = raw
          .prepare('SELECT * FROM preparation_progress')
          .all();
        const movementsBefore = await listStockMovements(database, id);
        await discardExpiredMedicationBox(
          database,
          id,
          completed ? 26.5 : 30,
          '2028-01-01',
        );
        expect(
          raw.prepare('SELECT * FROM preparation_box_usages').all(),
        ).toEqual(usagesBefore);
        expect(raw.prepare('SELECT * FROM preparation_progress').all()).toEqual(
          progressBefore,
        );
        expect((await listStockMovements(database, id)).slice(1)).toEqual(
          movementsBefore,
        );
        if (!completed) {
          await expect(
            completePreparation(database, preparationId, '2028-01-01'),
          ).rejects.toThrow();
          expect(
            (await listMedicationBoxes(database))[0].remainingQuantity,
          ).toBe(0);
          expect(await listStockMovements(database, id)).toHaveLength(2);
        }
      } finally {
        raw.close();
      }
    },
  );
});

it('conserve la prise hors pilulier et son mouvement après déstockage du restant', async () => {
  const { raw, database } = await createDatabase();
  try {
    raw
      .prepare(
        `INSERT INTO treatments (id, specialty_cis, specialty_name, included_in_pillbox)
      VALUES (1, ?, 'Alpha', 0)`,
      )
      .run(manualDraft.specialtyCis);
    raw.exec(`INSERT INTO treatment_phases
      (id, treatment_id, position, start_date, frequency_type)
      VALUES (1, 1, 0, '2027-12-30', 'daily');
      INSERT INTO treatment_phase_dosages (phase_id, slot, quantity_half_units)
      VALUES (1, 'morning', 1);`);
    const id = await addMedicationBox(database, manualDraft);
    const intake = {
      key: '1:2027-12-30:morning',
      treatmentId: 1,
      date: '2027-12-30',
      slot: 'morning' as const,
      specialtyCis: manualDraft.specialtyCis,
      specialtyName: 'Alpha',
      pharmaceuticalForm: 'comprimé',
      quantityHalfUnits: 1,
    };
    await materializeIntakeSnapshots(database, [intake]);
    await takeOutsidePillboxIntake(database, intake.key, id, '2027-12-30');
    const records = raw.prepare('SELECT * FROM intake_records').all();
    const movements = await listStockMovements(database, id);
    await discardExpiredMedicationBox(database, id, 29.5, '2028-01-01');
    expect(raw.prepare('SELECT * FROM intake_records').all()).toEqual(records);
    expect((await listStockMovements(database, id)).slice(1)).toEqual(
      movements,
    );
    expect((await listMedicationBoxes(database))[0].remainingQuantity).toBe(0);
  } finally {
    raw.close();
  }
});
