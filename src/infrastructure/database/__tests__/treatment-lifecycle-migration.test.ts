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

describe('migration de l’historique du cycle de vie des traitements', () => {
  it('reprend l’archivage déjà connu, sans inventer de réactivation passée', async () => {
    const database = new Database(':memory:');
    await migrate(database, 1, 21);
    database.exec(`
      INSERT INTO treatments (id, specialty_cis, specialty_name, archived_at)
      VALUES (1, '60000001', 'Archivé de longue date', '2026-02-01 09:00:00');
      INSERT INTO treatments (id, specialty_cis, specialty_name, archived_at)
      VALUES (2, '60000002', 'Jamais archivé', NULL);
    `);

    await migrate(database, 22, LATEST_SCHEMA_VERSION);

    expect(
      database
        .prepare(
          'SELECT treatment_id, event_type, occurred_at FROM treatment_lifecycle_events ORDER BY treatment_id',
        )
        .all(),
    ).toEqual([
      {
        treatment_id: 1,
        event_type: 'ARCHIVED',
        occurred_at: '2026-02-01 09:00:00',
      },
    ]);
    database.close();
  });
});
