import Database from 'better-sqlite3';

import { LATEST_SCHEMA_VERSION, SCHEMA_MIGRATIONS } from '../schema-migrations';

function migratedDatabase(): Database.Database {
  const database = new Database(':memory:');
  for (const migration of SCHEMA_MIGRATIONS) {
    void migration.up({
      execute(sql) {
        database.exec(sql);
        return Promise.resolve();
      },
      readAppliedVersions: () => Promise.resolve([]),
      recordAppliedVersion: () => Promise.resolve(),
    });
  }
  return database;
}

describe('migration du cache de détection de version', () => {
  it('crée un singleton vide sans report ni release connue', () => {
    const database = migratedDatabase();

    expect(
      database.prepare('SELECT * FROM update_check_settings').get(),
    ).toMatchObject({
      singleton_id: 1,
      last_checked_at: null,
      latest_version: null,
      latest_release_url: null,
      latest_apk_url: null,
      postponed_version: null,
      postponed_at: null,
    });

    expect(() =>
      database
        .prepare('INSERT INTO update_check_settings (singleton_id) VALUES (2)')
        .run(),
    ).toThrow();

    database.close();
  });

  it('est bien la dernière version du schéma', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(SCHEMA_MIGRATIONS.length);
    expect(SCHEMA_MIGRATIONS.at(-1)?.version).toBe(LATEST_SCHEMA_VERSION);
  });
});
