import Database from 'better-sqlite3';

import { SCHEMA_MIGRATIONS } from '../schema-migrations';

async function migrate(database: Database.Database) {
  for (const migration of SCHEMA_MIGRATIONS)
    await migration.up({
      execute(sql) {
        database.exec(sql);
        return Promise.resolve();
      },
      readAppliedVersions: () => Promise.resolve([]),
      recordAppliedVersion: () => Promise.resolve(),
    });
}

describe('migration des traitements si besoin et des prises ponctuelles', () => {
  it('marque les traitements existants comme planifiés par défaut', async () => {
    const database = new Database(':memory:');
    await migrate(database);
    database
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000001', 'Alpha')`,
      )
      .run();
    expect(
      database.prepare('SELECT dosage_kind FROM treatments').get(),
    ).toEqual({ dosage_kind: 'SCHEDULED' });
    database.close();
  });

  it('contraint le type de traitement et les valeurs déclaratives si besoin', async () => {
    const database = new Database(':memory:');
    await migrate(database);
    expect(() =>
      database
        .prepare(
          `INSERT INTO treatments (specialty_cis, specialty_name, dosage_kind) VALUES ('60000001', 'Alpha', 'AUTRE')`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          `INSERT INTO treatments (specialty_cis, specialty_name, dosage_kind, as_needed_max_quantity_half_units)
           VALUES ('60000001', 'Alpha', 'AS_NEEDED', 0)`,
        )
        .run(),
    ).toThrow();
    database.close();
  });

  it('enregistre une prise ponctuelle liée à un traitement et la supprime en cascade', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    await migrate(database);
    const treatmentId = Number(
      database
        .prepare(
          `INSERT INTO treatments (specialty_cis, specialty_name, dosage_kind, included_in_pillbox)
           VALUES ('60000001', 'Alpha', 'AS_NEEDED', 0)`,
        )
        .run().lastInsertRowid,
    );
    database
      .prepare(
        `INSERT INTO as_needed_intake_records (treatment_id, taken_at, quantity_half_units, note)
         VALUES (?, '2026-08-11T14:00:00.000Z', 2, NULL)`,
      )
      .run(treatmentId);
    expect(
      database
        .prepare('SELECT COUNT(*) count FROM as_needed_intake_records')
        .get(),
    ).toEqual({ count: 1 });
    expect(() =>
      database
        .prepare(
          `INSERT INTO as_needed_intake_records (treatment_id, taken_at, quantity_half_units)
           VALUES (?, '2026-08-11T15:00:00.000Z', 0)`,
        )
        .run(treatmentId),
    ).toThrow();

    database.prepare('DELETE FROM treatments WHERE id = ?').run(treatmentId);

    expect(
      database
        .prepare('SELECT COUNT(*) count FROM as_needed_intake_records')
        .get(),
    ).toEqual({ count: 0 });
    database.close();
  });
});
