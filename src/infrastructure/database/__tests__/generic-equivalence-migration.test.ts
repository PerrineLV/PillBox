import Database from 'better-sqlite3';

import { SCHEMA_MIGRATIONS } from '../schema-migrations';

async function migrateAll(database: Database.Database) {
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
}

describe('migration des équivalences génériques confirmées', () => {
  it('mémorise une équivalence par couple (traitement, CIS), sans en inventer pour l’existant', async () => {
    const database = new Database(':memory:');
    await migrateAll(database);

    const treatment = database
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000001', 'Zoloft')`,
      )
      .run();

    database
      .prepare(
        `INSERT INTO generic_equivalence_confirmations
         (treatment_id, cis, specialty_name, group_label)
         VALUES (?, '60000002', 'Sertraline', 'Groupe sertraline')`,
      )
      .run(treatment.lastInsertRowid);

    expect(
      database
        .prepare(
          `SELECT treatment_id, cis, specialty_name, group_label FROM generic_equivalence_confirmations`,
        )
        .get(),
    ).toEqual({
      treatment_id: treatment.lastInsertRowid,
      cis: '60000002',
      specialty_name: 'Sertraline',
      group_label: 'Groupe sertraline',
    });

    expect(
      database
        .prepare(
          `SELECT name FROM pragma_table_info('preparation_progress') WHERE name IN ('matched_cis', 'matched_specialty_name')`,
        )
        .all(),
    ).toEqual([{ name: 'matched_cis' }, { name: 'matched_specialty_name' }]);
    expect(
      database
        .prepare(
          `SELECT name FROM pragma_table_info('preparation_box_usages') WHERE name IN ('matched_cis', 'matched_specialty_name')`,
        )
        .all(),
    ).toEqual([{ name: 'matched_cis' }, { name: 'matched_specialty_name' }]);
    database.close();
  });

  it('refuse un doublon de CIS pour un même traitement sans clé explicite de remplacement', async () => {
    const database = new Database(':memory:');
    await migrateAll(database);
    const treatment = database
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000001', 'Zoloft')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO generic_equivalence_confirmations
         (treatment_id, cis, specialty_name, group_label)
         VALUES (?, '60000002', 'Sertraline', 'Groupe sertraline')`,
      )
      .run(treatment.lastInsertRowid);

    expect(() =>
      database
        .prepare(
          `INSERT INTO generic_equivalence_confirmations
           (treatment_id, cis, specialty_name, group_label)
           VALUES (?, '60000002', 'Sertraline (bis)', 'Groupe sertraline')`,
        )
        .run(treatment.lastInsertRowid),
    ).toThrow();
    database.close();
  });

  it('supprime les équivalences mémorisées quand le traitement est supprimé (clé étrangère en cascade)', async () => {
    const database = new Database(':memory:');
    await migrateAll(database);
    const treatment = database
      .prepare(
        `INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000001', 'Zoloft')`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO generic_equivalence_confirmations
         (treatment_id, cis, specialty_name, group_label)
         VALUES (?, '60000002', 'Sertraline', 'Groupe sertraline')`,
      )
      .run(treatment.lastInsertRowid);

    database
      .prepare('DELETE FROM treatments WHERE id = ?')
      .run(treatment.lastInsertRowid);

    expect(
      database.prepare('SELECT * FROM generic_equivalence_confirmations').all(),
    ).toEqual([]);
    database.close();
  });
});
