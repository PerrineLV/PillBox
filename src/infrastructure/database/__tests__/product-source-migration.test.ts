import Database from 'better-sqlite3';

import { SCHEMA_MIGRATIONS } from '../schema-migrations';

describe('migration des provenances de produits', () => {
  it('conserve les traitements et boîtes BDPM existants et accepte un produit hors BDPM', async () => {
    const database = new Database(':memory:');
    try {
      for (const migration of SCHEMA_MIGRATIONS.slice(0, 28)) {
        await migration.up({
          execute(sql) {
            database.exec(sql);
            return Promise.resolve();
          },
          readAppliedVersions: () => Promise.resolve([]),
          recordAppliedVersion: () => Promise.resolve(),
        });
      }
      database
        .prepare(
          "INSERT INTO treatments (specialty_cis, specialty_name) VALUES ('60000001', 'Ancien médicament')",
        )
        .run();
      database
        .prepare(
          `INSERT INTO medication_boxes
          (specialty_cis, specialty_name, presentation_cip13, presentation_label,
           expiration_date, initial_quantity, remaining_quantity, scan_raw, source)
         VALUES ('60000001', 'Ancien médicament', '3400000000000', 'Boîte',
           '2027-01-01', 20, 20, '', 'MANUAL')`,
        )
        .run();
      await SCHEMA_MIGRATIONS[28].up({
        execute(sql) {
          database.exec(sql);
          return Promise.resolve();
        },
        readAppliedVersions: () => Promise.resolve([]),
        recordAppliedVersion: () => Promise.resolve(),
      });
      expect(
        database
          .prepare(
            'SELECT product_source, product_type FROM treatments WHERE id = 1',
          )
          .get(),
      ).toEqual({ product_source: 'BDPM', product_type: 'MEDICATION' });
      expect(
        database
          .prepare('SELECT product_source FROM medication_boxes WHERE id = 1')
          .get(),
      ).toEqual({ product_source: 'BDPM' });
      database
        .prepare(
          `INSERT INTO treatments (specialty_cis, specialty_name, product_source,
          product_type, external_id)
         VALUES ('COMPL_ALIM:123', 'Complément déclaré', 'COMPL_ALIM', 'SUPPLEMENT', '123')`,
        )
        .run();
      expect(
        database
          .prepare(
            'SELECT product_source, product_type, external_id FROM treatments WHERE id = 2',
          )
          .get(),
      ).toEqual({
        product_source: 'COMPL_ALIM',
        product_type: 'SUPPLEMENT',
        external_id: '123',
      });
    } finally {
      database.close();
    }
  });
});
