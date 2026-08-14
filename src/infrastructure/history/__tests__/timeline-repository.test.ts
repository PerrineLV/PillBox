import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { generatePreparationSnapshot } from '@/domain/preparations/preparation';
import type { TreatmentDraft } from '@/domain/treatments/treatment';
import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  addMedicationBox,
  adjustMedicationBox,
} from '@/infrastructure/inventory/inventory-repository';
import {
  materializeIntakeSnapshots,
  updateIntakeStatus,
} from '@/infrastructure/intakes/intake-repository';
import {
  completePreparation,
  createPreparation,
  savePreparationProgress,
} from '@/infrastructure/preparations/preparation-repository';
import {
  archiveTreatment,
  createTreatment,
  getTreatment,
  restoreArchivedTreatment,
} from '@/infrastructure/treatments/treatment-repository';

import { listTimelineEvents } from '../timeline-repository';

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

function adapter(raw: Database.Database): SQLiteDatabase {
  const database: TestDatabase = {
    async getFirstAsync<T>(sql: string, ...parameters: SqlParameters) {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...parameters: SqlParameters) {
      return raw.prepare(sql).all(...parameters) as T[];
    },
    async runAsync(sql: string, ...parameters: SqlParameters) {
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
  return { raw, database: adapter(raw) };
}

const DRAFT: TreatmentDraft = {
  specialtyCis: '60000001',
  specialtyName: 'Doliprane',
  pharmaceuticalForm: 'Comprimé',
  dosageKind: 'SCHEDULED',
  includedInPillbox: true,
  phases: [
    {
      id: null,
      startDate: '2026-08-01',
      endDate: null,
      frequency: { type: 'daily' },
      dosage: [{ slot: 'morning', quantityHalfUnits: 2 }],
    },
  ],
  asNeededInfo: { maxQuantityPerDayHalfUnits: null, minIntervalHours: null },
  controlledDispensing: null,
};

/** Constitue un historique complet pour un traitement : préparation validée
 * avec un lot, un mouvement de stock manuel, une prise confirmée, puis un
 * cycle archivage/réactivation. */
async function buildFullHistory(
  database: SQLiteDatabase,
): Promise<{ treatmentId: number }> {
  const treatmentId = await createTreatment(database, DRAFT);
  const boxId = await addMedicationBox(database, {
    specialtyCis: '60000001',
    specialtyName: 'Doliprane',
    pharmaceuticalForm: 'Comprimé',
    presentationCip13: '3400000000001',
    presentationLabel: 'Doliprane 500mg, 16 comprimés',
    lot: 'LOT-A',
    expirationDate: '2027-01-01',
    initialQuantity: 32,
    origin: 'MANUAL',
    scanRaw: null,
  });

  const treatment = await getTreatment(database, treatmentId);
  if (treatment === null) throw new Error('Traitement introuvable.');
  const snapshot = generatePreparationSnapshot(
    [treatment],
    [],
    '2026-08-10',
    '2026-08-01',
  );
  const preparationId = await createPreparation(database, snapshot);
  const requirement = snapshot.requirements[0];
  await savePreparationProgress(database, preparationId, {
    specialtyCis: requirement.specialtyCis,
    boxId,
    quantityHalfUnits: requirement.requiredHalfUnits,
    verification: 'MANUAL',
    scanRaw: null,
    nonFefoAcknowledged: false,
    matchedCis: null,
    matchedSpecialtyName: null,
  });
  await completePreparation(database, preparationId, '2026-08-16');

  await adjustMedicationBox(
    database,
    boxId,
    20,
    'MANUAL_ADJUSTMENT',
    'Comptage physique',
  );

  await materializeIntakeSnapshots(database, [
    {
      key: `${treatmentId}:2026-08-10:morning`,
      treatmentId,
      date: '2026-08-10',
      slot: 'morning',
      specialtyCis: '60000001',
      specialtyName: 'Doliprane',
      pharmaceuticalForm: 'Comprimé',
      quantityHalfUnits: 2,
    },
  ]);
  await updateIntakeStatus(
    database,
    `${treatmentId}:2026-08-10:morning`,
    'TAKEN',
  );

  await archiveTreatment(database, treatmentId);
  await restoreArchivedTreatment(database, treatmentId);

  return { treatmentId };
}

describe('listTimelineEvents', () => {
  it('assemble tous les types d’événements pour un traitement', async () => {
    const { raw, database } = await setup();
    const { treatmentId } = await buildFullHistory(database);

    const events = await listTimelineEvents(database, {
      treatmentId,
      startDate: null,
    });
    const types = new Set(events.map((event) => event.type));

    expect(types).toEqual(
      new Set([
        'TREATMENT_CREATED',
        'PHASE_STARTED',
        'PREPARATION_COMPLETED',
        'BOX_USED',
        'STOCK_MOVEMENT',
        'INTAKE_RECORDED',
        'TREATMENT_ARCHIVED',
        'TREATMENT_REACTIVATED',
      ]),
    );
    // Chronologique : l'archivage précède toujours sa réactivation.
    const archivedIndex = events.findIndex(
      (event) => event.type === 'TREATMENT_ARCHIVED',
    );
    const reactivatedIndex = events.findIndex(
      (event) => event.type === 'TREATMENT_REACTIVATED',
    );
    expect(archivedIndex).toBeGreaterThanOrEqual(0);
    expect(reactivatedIndex).toBeGreaterThan(archivedIndex);
    const occurredAts = events.map((event) => event.occurredAt);
    expect(occurredAts).toEqual([...occurredAts].sort());
    raw.close();
  });

  it('exclut le mouvement PILLBOX_PREPARATION, déjà représenté par la boîte utilisée', async () => {
    const { raw, database } = await setup();
    const { treatmentId } = await buildFullHistory(database);

    const events = await listTimelineEvents(database, {
      treatmentId,
      startDate: null,
    });
    const stockMovements = events.filter(
      (event) => event.type === 'STOCK_MOVEMENT',
    );

    // Le mouvement BOX_ADDED (ajout de la boîte) et l'ajustement manuel sont
    // conservés ; celui de type PILLBOX_PREPARATION, déjà représenté par
    // l'événement BOX_USED de la préparation, ne doit jamais apparaître ici.
    expect(
      stockMovements.map((event) =>
        event.type === 'STOCK_MOVEMENT' ? event.movementType : null,
      ),
    ).toEqual(['BOX_ADDED', 'MANUAL_ADJUSTMENT']);
    raw.close();
  });

  it('isole la timeline par traitement et retourne un tableau vide pour un identifiant absent', async () => {
    const { raw, database } = await setup();
    const { treatmentId } = await buildFullHistory(database);
    const secondId = await createTreatment(database, {
      ...DRAFT,
      specialtyCis: '60000002',
      specialtyName: 'Autre médicament',
    });

    const events = await listTimelineEvents(database, {
      treatmentId: secondId,
      startDate: null,
    });

    expect(events.every((event) => event.treatmentId === secondId)).toBe(true);
    expect(events.some((event) => event.treatmentId === treatmentId)).toBe(
      false,
    );

    const missing = await listTimelineEvents(database, {
      treatmentId: 999999,
      startDate: null,
    });
    expect(missing).toEqual([]);
    raw.close();
  });

  it('borne les quatre types de sources par startDate en SQL', async () => {
    const { raw, database } = await setup();
    const { treatmentId } = await buildFullHistory(database);

    // buildFullHistory produit un historique de cycle de vie (archivage,
    // réactivation), une préparation avec boîte utilisée, un mouvement de
    // stock manuel et une prise, tous situés en 2026-08. Seuls
    // TREATMENT_CREATED et PHASE_STARTED proviennent du traitement lui-même,
    // hors périmètre de ce filtre : ils restent présents quelle que soit la
    // borne basse.
    const futureEvents = await listTimelineEvents(database, {
      treatmentId,
      startDate: '2030-01-01',
    });
    expect(new Set(futureEvents.map((event) => event.type))).toEqual(
      new Set(['TREATMENT_CREATED', 'PHASE_STARTED']),
    );

    const allEvents = await listTimelineEvents(database, {
      treatmentId,
      startDate: null,
    });
    expect(allEvents.length).toBeGreaterThan(futureEvents.length);

    // Une borne basse antérieure à tout l'historique doit le laisser intact.
    const pastEvents = await listTimelineEvents(database, {
      treatmentId,
      startDate: '2020-01-01',
    });
    expect(pastEvents).toEqual(allEvents);
    raw.close();
  });
});
