import Database from 'better-sqlite3';

import { LATEST_SCHEMA_VERSION, SCHEMA_MIGRATIONS } from '../schema-migrations';

async function migrate(
  database: Database.Database,
  from: number,
  upTo: number,
) {
  for (const migration of SCHEMA_MIGRATIONS) {
    if (migration.version < from || migration.version > upTo) continue;
    await migration.up({
      execute(sql) {
        database.exec(sql);
        return Promise.resolve();
      },
      readAppliedVersions: () => Promise.resolve([]),
      recordAppliedVersion: () => Promise.resolve(),
    });
  }
}

describe('migration de l’origine des boîtes', () => {
  it('déclare comme scannées les boîtes et vérifications déjà enregistrées', async () => {
    const database = new Database(':memory:');
    await migrate(database, 1, 15);
    database.exec(`
      INSERT INTO medication_boxes
        (id, specialty_cis, specialty_name, presentation_cip13, presentation_label,
         lot, serial_number, expiration_date, initial_quantity, remaining_quantity, scan_raw)
      VALUES (5, '60000001', 'Alpha', '3400000000001', 'Boîte', 'LOT-A', 'SERIE-9',
              '2027-12-31', 30, 30, 'raw-historique');
      INSERT INTO preparations (id, start_date, end_date) VALUES (7, '2026-08-10', '2026-08-16');
      INSERT INTO preparation_requirements VALUES (7, '60000001', 'Alpha', 7, 60, 0);
      INSERT INTO preparation_progress (preparation_id, specialty_cis, box_id, scan_raw)
      VALUES (7, '60000001', 5, 'raw-historique');
      INSERT INTO preparation_box_usages
        (preparation_id, specialty_cis, specialty_name, box_id, presentation_cip13,
         presentation_label, lot, serial_number, expiration_date, quantity_half_units)
      VALUES (7, '60000001', 'Alpha', 5, '3400000000001', 'Boîte', 'LOT-A', 'SERIE-9',
              '2027-12-31', 7);
    `);

    await migrate(database, 16, LATEST_SCHEMA_VERSION);

    expect(
      database
        .prepare('SELECT source, serial_number FROM medication_boxes')
        .get(),
    ).toEqual({ source: 'SCAN', serial_number: 'SERIE-9' });
    expect(
      database.prepare('SELECT verification FROM preparation_progress').get(),
    ).toEqual({ verification: 'SCAN' });
    expect(
      database.prepare('SELECT verification FROM preparation_box_usages').get(),
    ).toEqual({ verification: 'SCAN' });
    database.close();
  });

  it('n’accepte que les origines et vérifications connues', async () => {
    const database = new Database(':memory:');
    await migrate(database, 1, LATEST_SCHEMA_VERSION);

    expect(() =>
      database
        .prepare(
          `INSERT INTO medication_boxes
           (specialty_cis, specialty_name, presentation_cip13, presentation_label,
            expiration_date, initial_quantity, remaining_quantity, source, scan_raw)
           VALUES ('60000001', 'Alpha', '3400000000001', 'Boîte',
                   '2027-12-31', 30, 30, 'DEVINÉ', '')`,
        )
        .run(),
    ).toThrow();
    database.close();
  });
});
