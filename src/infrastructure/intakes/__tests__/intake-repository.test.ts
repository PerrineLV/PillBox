import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { generateIntakes } from '@/domain/treatments/generate-intakes';
import { INTAKE_SLOTS } from '@/domain/treatments/treatment';
import { intakeRecordKey } from '@/domain/intakes/intake-tracking';
import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';
import {
  archiveTreatment,
  getTreatmentRemovalAction,
  getTreatment,
  updateTreatment,
} from '@/infrastructure/treatments/treatment-repository';
import {
  deleteIntakePostponement,
  getIntakePostponement,
  listIntakeHistory,
  listIntakeRecordsForGroups,
  listPendingIntakeCounts,
  markPendingIntakesTaken,
  markPendingIntakesTakenForGroups,
  materializeIntakeSnapshots,
  saveIntakePostponement,
  takeOutsidePillboxIntake,
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
    INSERT INTO treatment_phase_dosages (phase_id, slot, quantity_half_units) VALUES (10, 'morning', 2), (10, 'noon', 2);
    INSERT INTO treatments (id, specialty_cis, specialty_name) VALUES (2, 'cis-2', 'Beta'), (3, 'cis-3', 'Gamma');
    INSERT INTO treatment_phases (id, treatment_id, position, start_date, frequency_type) VALUES (20, 2, 0, '2026-08-01', 'daily'), (30, 3, 0, '2026-08-01', 'daily');
    INSERT INTO treatment_phase_dosages (phase_id, slot, quantity_half_units) VALUES (20, 'morning', 2), (30, 'morning', 2);`);
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
const beta = {
  ...snapshot,
  key: intakeRecordKey(2, '2026-08-10', 'morning'),
  treatmentId: 2,
  specialtyCis: 'cis-2',
  specialtyName: 'Beta',
};

describe('suivi local des prises', () => {
  it('consomme une seule fois le lot explicitement choisi pour une prise hors pilulier', async () => {
    const { raw, database } = await setup();
    raw
      .prepare('UPDATE treatments SET included_in_pillbox = 0 WHERE id = 1')
      .run();
    const boxId = Number(
      raw
        .prepare(
          `INSERT INTO medication_boxes
           (specialty_cis, specialty_name, presentation_cip13, presentation_label,
            lot, expiration_date, initial_quantity, remaining_quantity, scan_raw)
           VALUES ('cis-1', 'Alpha', '3400000000001', 'Boîte', 'LOT-1',
             '2027-01-01', 10, 10, 'raw')`,
        )
        .run().lastInsertRowid,
    );
    await materializeIntakeSnapshots(database, [snapshot]);

    await takeOutsidePillboxIntake(database, snapshot.key, boxId, '2026-08-10');

    expect(
      raw
        .prepare('SELECT remaining_quantity FROM medication_boxes WHERE id = ?')
        .get(boxId),
    ).toEqual({ remaining_quantity: 9 });
    expect(
      raw
        .prepare(
          `SELECT type, intake_key, quantity_delta, quantity_after
           FROM stock_movements WHERE intake_key = ?`,
        )
        .get(snapshot.key),
    ).toEqual({
      type: 'OUTSIDE_PILLBOX_INTAKE',
      intake_key: snapshot.key,
      quantity_delta: -1,
      quantity_after: 9,
    });
    await expect(
      takeOutsidePillboxIntake(database, snapshot.key, boxId, '2026-08-10'),
    ).rejects.toThrow('déjà renseignée');
    await expect(
      updateIntakeStatus(database, snapshot.key, 'UNSET'),
    ).rejects.toThrow('déjà décrémenté le stock');
    raw.close();
  });

  it('refuse de valider directement une prise hors pilulier sans choisir de lot', async () => {
    const { raw, database } = await setup();
    raw
      .prepare('UPDATE treatments SET included_in_pillbox = 0 WHERE id = 1')
      .run();
    await materializeIntakeSnapshots(database, [snapshot]);

    await expect(
      updateIntakeStatus(database, snapshot.key, 'TAKEN'),
    ).rejects.toThrow('Choisissez la boîte utilisée');
    expect(
      await markPendingIntakesTaken(database, '2026-08-10', 'morning'),
    ).toBe(0);
    raw.close();
  });

  it('refuse une boîte périmée sans modifier la prise ni le stock hors pilulier', async () => {
    const { raw, database } = await setup();
    raw
      .prepare('UPDATE treatments SET included_in_pillbox = 0 WHERE id = 1')
      .run();
    const boxId = Number(
      raw
        .prepare(
          `INSERT INTO medication_boxes
           (specialty_cis, specialty_name, presentation_cip13, presentation_label,
            lot, expiration_date, initial_quantity, remaining_quantity, scan_raw)
           VALUES ('cis-1', 'Alpha', '3400000000002', 'Boîte', 'LOT-PÉRIMÉ',
             '2026-08-09', 10, 10, 'raw')`,
        )
        .run().lastInsertRowid,
    );
    await materializeIntakeSnapshots(database, [snapshot]);

    await expect(
      takeOutsidePillboxIntake(database, snapshot.key, boxId, '2026-08-10'),
    ).rejects.toThrow('périmée');
    expect(
      raw
        .prepare('SELECT remaining_quantity FROM medication_boxes WHERE id = ?')
        .get(boxId),
    ).toEqual({ remaining_quantity: 10 });
    expect(raw.prepare('SELECT status FROM intake_records').get()).toEqual({
      status: 'UNSET',
    });
    raw.close();
  });

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

  it('valide en une seule action tous les médicaments en attente d’un créneau, à la même heure', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [
      snapshot,
      beta,
      {
        ...snapshot,
        key: intakeRecordKey(1, '2026-08-10', 'noon'),
        slot: 'noon',
      },
    ]);

    // Les deux prises partent d'heures différentes : seule une validation
    // simultanée peut les ramener à une heure commune.
    raw
      .prepare(
        `UPDATE intake_records SET updated_at = '2020-01-01 00:00:00'
         WHERE intake_key = ?`,
      )
      .run(snapshot.key);
    raw
      .prepare(
        `UPDATE intake_records SET updated_at = '2020-01-02 00:00:00'
         WHERE intake_key = ?`,
      )
      .run(beta.key);

    expect(
      await markPendingIntakesTaken(database, '2026-08-10', 'morning'),
    ).toBe(2);

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
    const morningTimes = raw
      .prepare(
        `SELECT DISTINCT updated_at FROM intake_records WHERE slot = 'morning'`,
      )
      .all() as { updated_at: string }[];
    expect(morningTimes).toHaveLength(1);
    expect(morningTimes[0].updated_at).not.toBe('2020-01-01 00:00:00');
    expect(
      raw.prepare('SELECT COUNT(*) count FROM stock_movements').get(),
    ).toEqual({
      count: 0,
    });
    raw.close();
  });

  it('valide plusieurs créneaux par une seule écriture sur la connexion partagée', async () => {
    const runAsync = jest.fn().mockResolvedValue({
      changes: 3,
      lastInsertRowId: 0,
    });
    const withExclusiveTransactionAsync = jest.fn(() =>
      Promise.reject(new Error('database is locked')),
    );
    const database = {
      runAsync,
      withExclusiveTransactionAsync,
    } as unknown as SQLiteDatabase;

    await expect(
      markPendingIntakesTakenForGroups(database, [
        { date: '2026-08-10', slot: 'morning' },
        { date: '2026-08-10', slot: 'noon' },
        { date: '2026-08-10', slot: 'morning' },
      ]),
    ).resolves.toBe(3);

    expect(withExclusiveTransactionAsync).not.toHaveBeenCalled();
    expect(runAsync).toHaveBeenCalledTimes(1);
    expect(runAsync.mock.calls[0].slice(1)).toEqual([
      'UNSET',
      '2026-08-10',
      'morning',
      '2026-08-10',
      'noon',
    ]);
  });

  it('ne modifie ni les prises déjà validées ni les prises ignorées du créneau', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [
      snapshot,
      beta,
      {
        ...snapshot,
        key: intakeRecordKey(3, '2026-08-10', 'morning'),
        treatmentId: 3,
        specialtyCis: 'cis-3',
        specialtyName: 'Gamma',
      },
    ]);
    raw
      .prepare(
        `UPDATE intake_records
         SET status = ?, updated_at = '2020-01-01 00:00:00'
         WHERE intake_key = ?`,
      )
      .run('TAKEN', snapshot.key);
    raw
      .prepare(
        `UPDATE intake_records
         SET status = ?, updated_at = '2020-01-01 00:00:00'
         WHERE intake_key = ?`,
      )
      .run('SKIPPED', beta.key);

    expect(
      await markPendingIntakesTaken(database, '2026-08-10', 'morning'),
    ).toBe(1);

    const rows = raw
      .prepare(
        `SELECT specialty_name, status, updated_at FROM intake_records
         ORDER BY specialty_name`,
      )
      .all() as {
      specialty_name: string;
      status: string;
      updated_at: string;
    }[];
    expect(
      rows.map(({ specialty_name, status, updated_at }) => ({
        specialty_name,
        status,
        updated_at,
      })),
    ).toEqual([
      {
        specialty_name: 'Alpha',
        status: 'TAKEN',
        updated_at: '2020-01-01 00:00:00',
      },
      {
        specialty_name: 'Beta',
        status: 'SKIPPED',
        updated_at: '2020-01-01 00:00:00',
      },
      {
        specialty_name: 'Gamma',
        status: 'TAKEN',
        updated_at: rows[2].updated_at,
      },
    ]);
    expect(rows[2].updated_at).not.toBe('2020-01-01 00:00:00');

    expect(
      await markPendingIntakesTaken(database, '2026-08-10', 'morning'),
    ).toBe(0);
    expect(
      raw
        .prepare(`SELECT updated_at FROM intake_records WHERE intake_key = ?`)
        .get(beta.key),
    ).toEqual({ updated_at: '2020-01-01 00:00:00' });
    raw.close();
  });

  it('préserve identité et snapshot après recalcul, recréation des phases et archivage', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [snapshot]);
    // Une prise UNSET (jamais prise ni ignorée) n'empêche plus la suppression
    // définitive : ce n'est qu'un aide-mémoire de planification. On marque
    // donc ici la prise comme réellement effectuée, pour vérifier que
    // l'archivage (seule option restante) préserve bien le snapshot
    // d'origine, comme la suppression le ferait pour une prise jamais prise.
    await updateIntakeStatus(database, snapshot.key, 'TAKEN');
    // Un recalcul après la décision explicite ne doit jamais la réécrire.
    await materializeIntakeSnapshots(database, [
      { ...snapshot, specialtyName: 'Nom modifié', quantityHalfUnits: 6 },
    ]);
    await updateTreatment(database, {
      id: 1,
      specialtyCis: 'cis-1',
      specialtyName: 'Alpha modifié',
      pharmaceuticalForm: 'gélule',
      dosageKind: 'SCHEDULED',
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
      asNeededInfo: {
        maxQuantityPerDayHalfUnits: null,
        minIntervalHours: null,
      },
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

  it('répercute une posologie modifiée sur une prise future encore UNSET déjà matérialisée', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [snapshot]);

    await materializeIntakeSnapshots(database, [
      {
        ...snapshot,
        specialtyName: 'Alpha modifié',
        pharmaceuticalForm: 'gélule',
        quantityHalfUnits: 4,
      },
    ]);

    const record = (
      await listIntakeHistory(database, {
        startDate: null,
        endDate: '2026-08-31',
        treatmentId: null,
      })
    )[0];
    expect(record).toMatchObject({
      key: snapshot.key,
      status: 'UNSET',
      specialtyName: 'Alpha modifié',
      pharmaceuticalForm: 'gélule',
      quantityHalfUnits: 4,
    });
    raw.close();
  });

  it('ne modifie jamais une prise TAKEN ou SKIPPED déjà matérialisée, même si la posologie source a changé', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [snapshot, beta]);
    await updateIntakeStatus(database, snapshot.key, 'TAKEN');
    await updateIntakeStatus(database, beta.key, 'SKIPPED');
    raw.exec(`UPDATE intake_records SET updated_at = '2020-01-01 00:00:00'`);

    await materializeIntakeSnapshots(database, [
      { ...snapshot, specialtyName: 'Nom modifié', quantityHalfUnits: 6 },
      { ...beta, specialtyName: 'Nom modifié', quantityHalfUnits: 6 },
    ]);

    const rows = raw
      .prepare(
        `SELECT specialty_name, quantity_half_units, status, updated_at
         FROM intake_records ORDER BY specialty_name`,
      )
      .all();
    expect(rows).toEqual([
      {
        specialty_name: 'Alpha',
        quantity_half_units: 2,
        status: 'TAKEN',
        updated_at: '2020-01-01 00:00:00',
      },
      {
        specialty_name: 'Beta',
        quantity_half_units: 2,
        status: 'SKIPPED',
        updated_at: '2020-01-01 00:00:00',
      },
    ]);
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

  it('valide plusieurs créneaux d’un même rappel à une heure unique', async () => {
    const { raw, database } = await setup();
    const noon = {
      ...snapshot,
      key: intakeRecordKey(1, '2026-08-10', 'noon'),
      slot: 'noon' as const,
    };
    const nextDay = {
      ...snapshot,
      key: intakeRecordKey(1, '2026-08-11', 'morning'),
      date: '2026-08-11',
    };
    await materializeIntakeSnapshots(database, [snapshot, beta, noon, nextDay]);
    raw.exec(`UPDATE intake_records SET updated_at = '2020-01-01 00:00:00'`);

    expect(
      await markPendingIntakesTakenForGroups(database, [
        { date: '2026-08-10', slot: 'morning' },
        { date: '2026-08-10', slot: 'noon' },
        // Un créneau répété ne doit pas compter deux fois.
        { date: '2026-08-10', slot: 'noon' },
      ]),
    ).toBe(3);

    const validated = raw
      .prepare(
        `SELECT DISTINCT updated_at FROM intake_records WHERE status = 'TAKEN'`,
      )
      .all() as { updated_at: string }[];
    expect(validated).toHaveLength(1);
    expect(validated[0].updated_at).not.toBe('2020-01-01 00:00:00');
    expect(
      raw
        .prepare(
          `SELECT status, updated_at FROM intake_records WHERE intake_key = ?`,
        )
        .get(nextDay.key),
    ).toEqual({ status: 'UNSET', updated_at: '2020-01-01 00:00:00' });
    raw.close();
  });

  it('rejoue une action de notification sans créer de doublon ni réécrire une prise validée', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [snapshot, beta]);
    const groups = [{ date: '2026-08-10', slot: 'morning' as const }];

    expect(await markPendingIntakesTakenForGroups(database, groups)).toBe(2);
    const after = raw
      .prepare('SELECT intake_key, status, updated_at FROM intake_records')
      .all();
    // Deuxième réception de la même action : plus rien n'est en attente.
    expect(await markPendingIntakesTakenForGroups(database, groups)).toBe(0);
    expect(
      raw
        .prepare('SELECT intake_key, status, updated_at FROM intake_records')
        .all(),
    ).toEqual(after);
    expect(
      raw.prepare('SELECT COUNT(*) count FROM intake_records').get(),
    ).toEqual({ count: 2 });
    raw.close();
  });

  it('ne valide rien lorsque le rappel ne désigne aucun créneau', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [snapshot]);
    expect(await markPendingIntakesTakenForGroups(database, [])).toBe(0);
    expect(raw.prepare('SELECT status FROM intake_records').get()).toEqual({
      status: 'UNSET',
    });
    raw.close();
  });

  it('compte les prises en attente par créneau sur la période demandée', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [
      snapshot,
      beta,
      {
        ...snapshot,
        key: intakeRecordKey(1, '2026-08-10', 'noon'),
        slot: 'noon',
      },
      {
        ...snapshot,
        key: intakeRecordKey(1, '2026-08-12', 'morning'),
        date: '2026-08-12',
      },
    ]);
    await updateIntakeStatus(database, beta.key, 'SKIPPED');

    expect(
      await listPendingIntakeCounts(database, '2026-08-10', '2026-08-11'),
    ).toEqual([
      { date: '2026-08-10', slot: 'morning', pending: 1 },
      { date: '2026-08-10', slot: 'noon', pending: 1 },
    ]);
    raw.close();
  });
});

describe('ticket 107 — prises devenues inapplicables', () => {
  it.each(['avant', 'après'] as const)(
    'exclut un archivage %s matérialisation, même après fermeture et réouverture SQLite',
    async (moment) => {
      const initial = await setup();
      let raw = initial.raw;
      const database = initial.database;
      // Une décision passée justifie l’archivage et doit être conservée.
      const past = {
        ...snapshot,
        key: intakeRecordKey(1, '2026-08-09', 'morning'),
        date: '2026-08-09',
      };
      await materializeIntakeSnapshots(database, [past]);
      await updateIntakeStatus(database, past.key, 'TAKEN');
      if (moment === 'après')
        await materializeIntakeSnapshots(database, [snapshot]);
      await archiveTreatment(database, 1);
      if (moment === 'avant')
        await materializeIntakeSnapshots(database, [snapshot]);
      await materializeIntakeSnapshots(database, [beta]);
      const directory = mkdtempSync(join(tmpdir(), 'pillbox-107-'));
      const file = join(directory, 'restart.sqlite');
      writeFileSync(file, raw.serialize());
      raw.close();
      raw = new Database(file);
      const restarted = adapter(raw);
      expect(
        (
          await listIntakeRecordsForGroups(restarted, snapshot.date, [
            'morning',
          ])
        ).map((r) => r.key),
      ).toEqual([beta.key]);
      expect(
        await listPendingIntakeCounts(restarted, snapshot.date, snapshot.date),
      ).toEqual([{ date: snapshot.date, slot: 'morning', pending: 1 }]);
      await expect(
        updateIntakeStatus(restarted, snapshot.key, 'TAKEN'),
      ).rejects.toThrow('inapplicable');
      expect(
        await markPendingIntakesTaken(restarted, snapshot.date, 'morning'),
      ).toBe(1);
      expect(
        await listIntakeHistory(restarted, {
          startDate: null,
          endDate: snapshot.date,
          treatmentId: 1,
        }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: past.key, status: 'TAKEN' }),
          expect.objectContaining({ key: snapshot.key, status: 'UNSET' }),
        ]),
      );
      expect(
        raw.prepare('SELECT COUNT(*) count FROM stock_movements').get(),
      ).toEqual({ count: 0 });
      raw.close();
      rmSync(directory, { recursive: true });
    },
  );

  it('évalue chaque occurrence à sa date et ne reprend pas une ancienne phase du matin', async () => {
    const { raw, database } = await setup();
    const past = {
      ...snapshot,
      key: intakeRecordKey(1, '2026-08-09', 'morning'),
      date: '2026-08-09',
    };
    const noon = {
      ...snapshot,
      key: intakeRecordKey(1, snapshot.date, 'noon'),
      slot: 'noon' as const,
    };
    await materializeIntakeSnapshots(database, [past, snapshot, noon, beta]);
    raw.exec(`UPDATE treatment_phases SET end_date = '2026-08-09' WHERE id = 10;
      INSERT INTO treatment_phases (id, treatment_id, position, start_date, end_date, frequency_type) VALUES (11, 1, 1, '2026-08-10', '2026-08-10', 'daily');
      INSERT INTO treatment_phase_dosages (phase_id, slot, quantity_half_units) VALUES (11, 'noon', 2);`);
    expect(
      (await listIntakeRecordsForGroups(database, past.date, ['morning'])).map(
        (r) => r.key,
      ),
    ).toEqual([past.key]);
    expect(
      (
        await listIntakeRecordsForGroups(database, snapshot.date, [
          'morning',
          'noon',
        ])
      ).map((r) => r.key),
    ).toEqual([beta.key, noon.key]);
    raw.exec(
      `UPDATE treatment_phases SET end_date = '2026-08-09', start_date = '2026-08-09' WHERE id = 11`,
    );
    expect(
      (
        await listIntakeRecordsForGroups(database, snapshot.date, [
          'morning',
          'noon',
        ])
      ).map((r) => r.key),
    ).toEqual([beta.key]);
    expect(
      await markPendingIntakesTakenForGroups(database, [
        { date: snapshot.date, slot: 'morning' },
        { date: snapshot.date, slot: 'noon' },
      ]),
    ).toBe(1);
    raw.close();
  });

  it('refuse une ancienne prise hors pilulier sans consommer de stock', async () => {
    const { raw, database } = await setup();
    await materializeIntakeSnapshots(database, [snapshot]);
    raw.exec(`UPDATE treatments SET included_in_pillbox = 0;
      UPDATE treatment_phases SET end_date = '2026-08-09'`);
    await expect(
      takeOutsidePillboxIntake(database, snapshot.key, 123, snapshot.date),
    ).rejects.toThrow('introuvable');
    expect(
      raw.prepare('SELECT COUNT(*) count FROM stock_movements').get(),
    ).toEqual({ count: 0 });
    raw.close();
  });
});

it.each([
  "frequency_type = 'daily', start_date = '2026-08-09', end_date = '2026-08-11'",
  "frequency_type = 'weekly', weekly_weekday = 'monday'",
  "frequency_type = 'interval', interval_days = 3, anchor_date = '2026-08-11'",
  "frequency_type = 'legacy_weekdays', start_date = NULL",
])('garde le filtre SQLite cohérent avec le générateur : %s', async (phase) => {
  const { raw, database } = await setup();
  raw.exec(`UPDATE treatment_phases SET ${phase} WHERE id = 10;
    UPDATE treatment_phase_dosages SET weekday = 'monday' WHERE phase_id = 10`);
  const treatment = await getTreatment(database, 1);
  if (!treatment) throw new Error('Traitement témoin absent');
  for (const date of [
    '2026-08-08',
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-17',
  ]) {
    await materializeIntakeSnapshots(
      database,
      INTAKE_SLOTS.map((slot) => ({
        ...snapshot,
        date,
        slot,
        key: intakeRecordKey(1, date, slot),
      })),
    );
    const expected = generateIntakes([treatment], date, date)
      .map((item) => item.slot)
      .sort();
    expect(
      (await listIntakeRecordsForGroups(database, date, INTAKE_SLOTS))
        .map((item) => item.slot)
        .sort(),
    ).toEqual(expected);
    expect(
      (await listPendingIntakeCounts(database, date, date))
        .map((item) => item.slot)
        .sort(),
    ).toEqual(expected);
    expect(
      await markPendingIntakesTakenForGroups(
        database,
        INTAKE_SLOTS.map((slot) => ({ date, slot })),
      ),
    ).toBe(expected.length);
  }
  raw.close();
});
