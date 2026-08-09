import Database from 'better-sqlite3';

import { SCHEMA_MIGRATIONS } from '../schema-migrations';

describe('migration des posologies existantes vers les phases', () => {
  it('copie sans perte les jours, créneaux et demi-unités', async () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    for (const migration of SCHEMA_MIGRATIONS.filter(
      (item) => item.version <= 3,
    ))
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

    const treatment = database
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name, active, included_in_pillbox)
       VALUES ('60000001', 'Traitement existant', 1, 1)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO treatment_dosages (treatment_id, weekday, slot, quantity_half_units)
       VALUES (?, 'monday', 'morning', 1), (?, 'wednesday', 'bedtime', 3)`,
      )
      .run(treatment.lastInsertRowid, treatment.lastInsertRowid);

    const migration = SCHEMA_MIGRATIONS.find((item) => item.version === 4);
    if (!migration) throw new Error('Migration 4 absente.');
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

    expect(
      database
        .prepare(
          `SELECT phase.frequency_type, phase.start_date, dosage.weekday, dosage.slot, dosage.quantity_half_units
       FROM treatment_phases phase
       JOIN treatment_phase_dosages dosage ON dosage.phase_id = phase.id
       ORDER BY dosage.weekday`,
        )
        .all(),
    ).toEqual([
      {
        frequency_type: 'legacy_weekdays',
        start_date: null,
        weekday: 'monday',
        slot: 'morning',
        quantity_half_units: 1,
      },
      {
        frequency_type: 'legacy_weekdays',
        start_date: null,
        weekday: 'wednesday',
        slot: 'bedtime',
        quantity_half_units: 3,
      },
    ]);
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM treatment_dosages').get(),
    ).toEqual({ count: 2 });
    database.close();
  });
});
