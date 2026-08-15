import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { PrescriptionItemDraft } from '@/domain/prescriptions/prescription';
import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import { createTreatment } from '@/infrastructure/treatments/treatment-repository';

import {
  confirmPrescriptionReplacement,
  createPrescription,
  createPrescriptionItem,
  deletePrescription,
  deletePrescriptionItem,
  getPrescription,
  getPrescriptionItem,
  listActivePrescriptionsCoveringTreatments,
  listPrescriptionItems,
  listPrescriptionItemsByPrescription,
  listPrescriptionItemsByTreatment,
  listPrescriptions,
  updatePrescription,
  updatePrescriptionItem,
} from '../prescription-repository';

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
  const database = adapter(raw);
  const treatmentId = await createTreatment(database, {
    specialtyCis: '60000001',
    specialtyName: 'Alpha',
    pharmaceuticalForm: 'comprimé',
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
  });
  return { raw, database, treatmentId };
}

function fractionalItemDraft(
  treatmentId: number,
  prescriptionId: number,
  overrides: Partial<PrescriptionItemDraft> = {},
): PrescriptionItemDraft {
  return {
    prescriptionId,
    treatmentId,
    quantityKind: 'DURATION',
    durationDays: 28,
    boxCount: null,
    dispensingMode: 'FRACTIONAL',
    periodicityDays: 28,
    lastDispensedAt: '2026-08-01',
    theoreticalRenewalDate: '2026-08-29',
    toleranceDays: null,
    ...overrides,
  };
}

describe('Prescription (ticket 45)', () => {
  it('crée puis retrouve une ordonnance active', async () => {
    const { database } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo généraliste',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });

    const prescription = await getPrescription(database, id, '2026-08-14');
    expect(prescription).toMatchObject({
      label: 'Ordo généraliste',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
      status: 'ACTIVE',
    });
  });

  it('calcule le statut EXPIRED après la fin de validité', async () => {
    const { database } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo généraliste',
      issueDate: '2026-01-01',
      validUntil: '2026-02-01',
    });

    const prescription = await getPrescription(database, id, '2026-08-14');
    expect(prescription?.status).toBe('EXPIRED');
  });

  it('accepte une fin de validité inconnue, jamais EXPIRED par elle-même', async () => {
    const { database } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo sans date connue',
      issueDate: '2020-01-01',
      validUntil: null,
    });

    const prescription = await getPrescription(database, id, '2026-08-14');
    expect(prescription).toMatchObject({ validUntil: null, status: 'ACTIVE' });
  });

  it('ne marque jamais REPLACED automatiquement, même quand une ordonnance plus récente couvre le même traitement', async () => {
    const { database, treatmentId } = await setup();
    const oldId = await createPrescription(database, {
      label: 'Ordo ancienne',
      issueDate: '2026-01-01',
      validUntil: '2026-12-01',
    });
    const newId = await createPrescription(database, {
      label: 'Ordo récente',
      issueDate: '2026-06-01',
      validUntil: '2026-12-01',
    });
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, oldId),
    );
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, newId),
    );

    const old = await getPrescription(database, oldId, '2026-08-14');
    const recent = await getPrescription(database, newId, '2026-08-14');
    expect(old?.status).toBe('ACTIVE');
    expect(recent?.status).toBe('ACTIVE');
  });

  it('calcule le statut REPLACED seulement après confirmation explicite du remplacement', async () => {
    const { database, treatmentId } = await setup();
    const oldId = await createPrescription(database, {
      label: 'Ordo ancienne',
      issueDate: '2026-01-01',
      validUntil: '2026-12-01',
    });
    const newId = await createPrescription(database, {
      label: 'Ordo récente',
      issueDate: '2026-06-01',
      validUntil: '2026-12-01',
    });
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, oldId),
    );
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, newId),
    );

    await confirmPrescriptionReplacement(database, oldId, newId);

    const old = await getPrescription(database, oldId, '2026-08-14');
    const recent = await getPrescription(database, newId, '2026-08-14');
    expect(old?.status).toBe('REPLACED');
    expect(recent?.status).toBe('ACTIVE');
  });

  it('rejette une ordonnance qui se remplacerait elle-même', async () => {
    const { database } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-01-01',
      validUntil: '2026-12-01',
    });

    await expect(
      confirmPrescriptionReplacement(database, id, id),
    ).rejects.toThrow('elle-même');
  });

  it('rejette la confirmation d’une ordonnance introuvable', async () => {
    const { database } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-01-01',
      validUntil: '2026-12-01',
    });

    await expect(
      confirmPrescriptionReplacement(database, 999, id),
    ).rejects.toThrow('introuvable');
  });

  it('rejette un intitulé vide', async () => {
    const { database } = await setup();
    await expect(
      createPrescription(database, {
        label: '  ',
        issueDate: '2026-08-01',
        validUntil: '2026-11-01',
      }),
    ).rejects.toThrow('intitulé');
  });

  it('rejette une fin de validité antérieure à l’émission', async () => {
    const { database } = await setup();
    await expect(
      createPrescription(database, {
        label: 'Ordo',
        issueDate: '2026-08-01',
        validUntil: '2026-07-01',
      }),
    ).rejects.toThrow('suivre');
  });

  it('met à jour une ordonnance existante', async () => {
    const { database } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });

    await updatePrescription(database, id, {
      label: 'Ordo renommée',
      issueDate: '2026-08-01',
      validUntil: '2026-12-01',
    });

    const prescription = await getPrescription(database, id, '2026-08-14');
    expect(prescription).toMatchObject({
      label: 'Ordo renommée',
      validUntil: '2026-12-01',
    });
  });

  it('liste les ordonnances triées par date d’émission décroissante', async () => {
    const { database } = await setup();
    await createPrescription(database, {
      label: 'Plus ancienne',
      issueDate: '2026-01-01',
      validUntil: '2026-12-01',
    });
    await createPrescription(database, {
      label: 'Plus récente',
      issueDate: '2026-06-01',
      validUntil: '2026-12-01',
    });

    const prescriptions = await listPrescriptions(database, '2026-08-14');
    expect(prescriptions.map((item) => item.label)).toEqual([
      'Plus récente',
      'Plus ancienne',
    ]);
  });

  it('supprime une ordonnance jamais associée à un traitement', async () => {
    const { database } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });

    await deletePrescription(database, id);

    expect(await getPrescription(database, id, '2026-08-14')).toBeNull();
  });

  it('refuse de supprimer une ordonnance qui couvre déjà un traitement', async () => {
    const { database, treatmentId } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, id),
    );

    await expect(deletePrescription(database, id)).rejects.toThrow(
      'historique',
    );
  });
});

describe('listActivePrescriptionsCoveringTreatments (ticket 48)', () => {
  it('retourne une ordonnance active couvrant l’un des traitements donnés', async () => {
    const { database, treatmentId } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo ancienne',
      issueDate: '2026-01-01',
      validUntil: '2026-12-01',
    });
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, id),
    );

    const overlaps = await listActivePrescriptionsCoveringTreatments(
      database,
      [treatmentId],
      '2026-08-14',
    );

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ id, label: 'Ordo ancienne' });
  });

  it('exclut une ordonnance déjà EXPIRED', async () => {
    const { database, treatmentId } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo expirée',
      issueDate: '2026-01-01',
      validUntil: '2026-02-01',
    });
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, id),
    );

    expect(
      await listActivePrescriptionsCoveringTreatments(
        database,
        [treatmentId],
        '2026-08-14',
      ),
    ).toHaveLength(0);
  });

  it('exclut une ordonnance déjà REPLACED', async () => {
    const { database, treatmentId } = await setup();
    const oldId = await createPrescription(database, {
      label: 'Ordo ancienne',
      issueDate: '2026-01-01',
      validUntil: '2026-12-01',
    });
    const newId = await createPrescription(database, {
      label: 'Ordo récente',
      issueDate: '2026-06-01',
      validUntil: '2026-12-01',
    });
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, oldId),
    );
    await confirmPrescriptionReplacement(database, oldId, newId);

    expect(
      await listActivePrescriptionsCoveringTreatments(
        database,
        [treatmentId],
        '2026-08-14',
      ),
    ).toHaveLength(0);
  });

  it('exclut l’ordonnance en cours d’édition d’elle-même', async () => {
    const { database, treatmentId } = await setup();
    const id = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-01-01',
      validUntil: '2026-12-01',
    });
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, id),
    );

    expect(
      await listActivePrescriptionsCoveringTreatments(
        database,
        [treatmentId],
        '2026-08-14',
        id,
      ),
    ).toHaveLength(0);
  });

  it('ne retourne rien sans traitement demandé', async () => {
    const { database } = await setup();
    expect(
      await listActivePrescriptionsCoveringTreatments(
        database,
        [],
        '2026-08-14',
      ),
    ).toEqual([]);
  });
});

describe('PrescriptionItem (ticket 45)', () => {
  it('crée puis retrouve une ligne en mode FRACTIONAL', async () => {
    const { database, treatmentId } = await setup();
    const prescriptionId = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });

    const id = await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, prescriptionId),
    );

    const item = await getPrescriptionItem(database, id);
    expect(item).toMatchObject({
      treatmentId,
      prescriptionId,
      quantityKind: 'DURATION',
      durationDays: 28,
      dispensingMode: 'FRACTIONAL',
      periodicityDays: 28,
      lastDispensedAt: '2026-08-01',
      theoreticalRenewalDate: '2026-08-29',
    });
  });

  it('accepte une ligne FULL sans information de fractionnement', async () => {
    const { database, treatmentId } = await setup();
    const prescriptionId = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });

    const id = await createPrescriptionItem(database, {
      prescriptionId,
      treatmentId,
      quantityKind: 'BOX_COUNT',
      durationDays: null,
      boxCount: 2,
      dispensingMode: 'FULL',
      periodicityDays: null,
      lastDispensedAt: null,
      theoreticalRenewalDate: null,
      toleranceDays: null,
    });

    const item = await getPrescriptionItem(database, id);
    expect(item).toMatchObject({
      quantityKind: 'BOX_COUNT',
      boxCount: 2,
      dispensingMode: 'FULL',
      periodicityDays: null,
    });
  });

  it('rejette une périodicité manquante en mode FRACTIONAL', async () => {
    const { database, treatmentId } = await setup();
    const prescriptionId = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });

    await expect(
      createPrescriptionItem(
        database,
        fractionalItemDraft(treatmentId, prescriptionId, {
          periodicityDays: null,
        }),
      ),
    ).rejects.toThrow('périodicité');
  });

  it('rejette une périodicité renseignée en mode FULL', async () => {
    const { database, treatmentId } = await setup();
    const prescriptionId = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });

    await expect(
      createPrescriptionItem(database, {
        prescriptionId,
        treatmentId,
        quantityKind: 'BOX_COUNT',
        durationDays: null,
        boxCount: 1,
        dispensingMode: 'FULL',
        periodicityDays: 28,
        lastDispensedAt: null,
        theoreticalRenewalDate: null,
        toleranceDays: null,
      }),
    ).rejects.toThrow('délivrance unique');
  });

  it('rejette un nombre de boîtes fourni pour une ligne exprimée en durée', async () => {
    const { database, treatmentId } = await setup();
    const prescriptionId = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });

    await expect(
      createPrescriptionItem(
        database,
        fractionalItemDraft(treatmentId, prescriptionId, { boxCount: 3 }),
      ),
    ).rejects.toThrow('nombre de boîtes');
  });

  it('met à jour une ligne existante', async () => {
    const { database, treatmentId } = await setup();
    const prescriptionId = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });
    const id = await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, prescriptionId),
    );
    const item = await getPrescriptionItem(database, id);
    if (item === null) throw new Error('Ligne introuvable.');

    await updatePrescriptionItem(database, {
      ...item,
      lastDispensedAt: '2026-08-15',
      theoreticalRenewalDate: '2026-09-12',
    });

    expect(await getPrescriptionItem(database, id)).toMatchObject({
      lastDispensedAt: '2026-08-15',
      theoreticalRenewalDate: '2026-09-12',
    });
  });

  it('supprime une ligne existante', async () => {
    const { database, treatmentId } = await setup();
    const prescriptionId = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });
    const id = await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, prescriptionId),
    );

    await deletePrescriptionItem(database, id);

    expect(await getPrescriptionItem(database, id)).toBeNull();
  });

  it('liste les lignes d’un traitement et d’une ordonnance', async () => {
    const { database, treatmentId } = await setup();
    const prescriptionId = await createPrescription(database, {
      label: 'Ordo',
      issueDate: '2026-08-01',
      validUntil: '2026-11-01',
    });
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, prescriptionId),
    );

    expect(
      await listPrescriptionItemsByTreatment(database, treatmentId),
    ).toHaveLength(1);
    expect(
      await listPrescriptionItemsByPrescription(database, prescriptionId),
    ).toHaveLength(1);
  });

  it('liste toutes les lignes, la plus récemment émise en premier', async () => {
    const { database, treatmentId } = await setup();
    const oldId = await createPrescription(database, {
      label: 'Ancienne',
      issueDate: '2026-01-01',
      validUntil: '2026-12-01',
    });
    const newId = await createPrescription(database, {
      label: 'Récente',
      issueDate: '2026-06-01',
      validUntil: '2026-12-01',
    });
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, oldId, {
        theoreticalRenewalDate: '2026-01-29',
      }),
    );
    await createPrescriptionItem(
      database,
      fractionalItemDraft(treatmentId, newId, {
        theoreticalRenewalDate: '2026-06-29',
      }),
    );

    const items = await listPrescriptionItems(database);
    expect(items.map((item) => item.theoreticalRenewalDate)).toEqual([
      '2026-06-29',
      '2026-01-29',
    ]);
  });
});
