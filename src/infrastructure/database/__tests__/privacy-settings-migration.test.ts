import Database from 'better-sqlite3';

import { SCHEMA_MIGRATIONS } from '../schema-migrations';

describe('migration des réglages de confidentialité', () => {
  it('crée un verrou désactivé par défaut et un singleton contraint', async () => {
    const database = new Database(':memory:');
    for (const migration of SCHEMA_MIGRATIONS) {
      await migration.up({
        execute(sql) {
          database.exec(sql);
          return Promise.resolve();
        },
        readAppliedVersions: () => Promise.resolve([]),
        recordAppliedVersion: () => Promise.resolve(),
      });
    }

    expect(
      database.prepare('SELECT * FROM privacy_settings').get(),
    ).toMatchObject({ singleton_id: 1, app_lock_enabled: 0 });
    expect(() =>
      database
        .prepare(
          'INSERT INTO privacy_settings (singleton_id, app_lock_enabled) VALUES (2, 1)',
        )
        .run(),
    ).toThrow();
    database.close();
  });
});
