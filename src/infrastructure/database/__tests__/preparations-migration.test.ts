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
});
