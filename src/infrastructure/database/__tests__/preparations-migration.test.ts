import Database from 'better-sqlite3';

import { SCHEMA_MIGRATIONS } from '../schema-migrations';

describe('migration des snapshots de préparation', () => {
  it('conserve les valeurs copiées après modification du traitement source', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS) {
      await migration.up({
        execute(sql) {
          database.exec(sql);
          return Promise.resolve();
        },
        readAppliedVersions() {
          return Promise.resolve([]);
        },
        recordAppliedVersion() {
          return Promise.resolve();
        },
      });
    }

    const treatment = database
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name)
         VALUES ('60000001', 'Nom au moment de la préparation')`,
      )
      .run();
    const preparation = database
      .prepare(
        `INSERT INTO preparations (start_date, end_date)
         VALUES ('2026-08-03', '2026-08-09')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO preparation_items
         (preparation_id, source_treatment_id, specialty_cis, specialty_name,
          intake_date, slot, quantity_half_units)
         VALUES (?, ?, '60000001', 'Nom au moment de la préparation',
          '2026-08-03', 'morning', 1)`,
      )
      .run(preparation.lastInsertRowid, treatment.lastInsertRowid);

    database
      .prepare(`UPDATE treatments SET specialty_name = 'Nom modifié ensuite'`)
      .run();

    expect(
      database
        .prepare(
          `SELECT specialty_name, quantity_half_units FROM preparation_items`,
        )
        .get(),
    ).toEqual({
      specialty_name: 'Nom au moment de la préparation',
      quantity_half_units: 1,
    });
    database.close();
  });

  it('sauvegarde une progression idempotente sans modifier le stock', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS) {
      await migration.up({
        execute(sql) {
          database.exec(sql);
          return Promise.resolve();
        },
        readAppliedVersions() {
          return Promise.resolve([]);
        },
        recordAppliedVersion() {
          return Promise.resolve();
        },
      });
    }
    const treatment = database
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000001', 'Alpha')`,
      )
      .run();
    const preparation = database
      .prepare(
        `INSERT INTO preparations (start_date, end_date) VALUES ('2026-08-03', '2026-08-09')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO preparation_requirements VALUES (?, '60000001', 'Alpha', 14, 20, 0)`,
      )
      .run(preparation.lastInsertRowid);
    const medicationBox = database
      .prepare(
        `INSERT INTO medication_boxes (specialty_cis, specialty_name, presentation_cip13, presentation_label, expiration_date, initial_quantity, remaining_quantity, scan_raw) VALUES ('60000001', 'Alpha', '3400000000000', 'Boîte', '2027-01-01', 10, 10, 'raw')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO preparation_progress
         (preparation_id, specialty_cis, box_id, quantity_half_units, verification, scan_raw)
         VALUES (?, '60000001', ?, 14, 'SCAN', 'scan-1')`,
      )
      .run(preparation.lastInsertRowid, medicationBox.lastInsertRowid);
    database
      .prepare(
        `INSERT INTO preparation_progress
         (preparation_id, specialty_cis, box_id, quantity_half_units, verification, scan_raw)
         VALUES (?, '60000001', ?, 14, 'SCAN', 'scan-2')
         ON CONFLICT(preparation_id, specialty_cis, box_id)
         DO UPDATE SET scan_raw = excluded.scan_raw`,
      )
      .run(preparation.lastInsertRowid, medicationBox.lastInsertRowid);
    expect(
      database.prepare(`SELECT scan_raw FROM preparation_progress`).get(),
    ).toEqual({ scan_raw: 'scan-2' });
    expect(
      database.prepare(`SELECT remaining_quantity FROM medication_boxes`).get(),
    ).toEqual({ remaining_quantity: 10 });
    expect(treatment.lastInsertRowid).toBeGreaterThan(0);
    database.close();
  });
});
