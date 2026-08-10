import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';

import { SCHEMA_MIGRATIONS } from '@/infrastructure/database/schema-migrations';

import {
  readUpdateCheckState,
  savePostponedVersion,
  saveUpdateCheckResult,
} from '../update-check-repository';

type Parameters = readonly (string | number | null)[];

const RELEASE = {
  version: '1.0.42',
  releaseUrl: 'https://github.com/PerrineLV/PillBox/releases/tag/v1.0.42',
  apkUrl:
    'https://github.com/PerrineLV/PillBox/releases/download/v1.0.42/pillbox-latest.apk',
};

async function database(): Promise<SQLiteDatabase> {
  const raw = new Database(':memory:');
  const api = {
    async getFirstAsync<T>(
      sql: string,
      ...parameters: Parameters
    ): Promise<T | null> {
      return (raw.prepare(sql).get(...parameters) as T | undefined) ?? null;
    },
    async runAsync(sql: string, ...parameters: Parameters) {
      const result = raw.prepare(sql).run(...parameters);
      return {
        changes: result.changes,
        lastInsertRowId: Number(result.lastInsertRowid),
      };
    },
  };

  for (const migration of SCHEMA_MIGRATIONS) {
    await migration.up({
      execute(sql) {
        raw.exec(sql);
        return Promise.resolve();
      },
      readAppliedVersions: () => Promise.resolve([]),
      recordAppliedVersion: () => Promise.resolve(),
    });
  }

  return api as unknown as SQLiteDatabase;
}

describe('cache local de la détection de version', () => {
  it('part d’un état vide', async () => {
    await expect(readUpdateCheckState(await database())).resolves.toEqual({
      lastCheckedAt: null,
      latestRelease: null,
      postponement: null,
    });
  });

  it('conserve la dernière release connue et la date de vérification', async () => {
    const local = await database();
    await saveUpdateCheckResult(local, '2026-08-10T09:00:00.000Z', RELEASE);

    await expect(readUpdateCheckState(local)).resolves.toEqual({
      lastCheckedAt: '2026-08-10T09:00:00.000Z',
      latestRelease: RELEASE,
      postponement: null,
    });
  });

  it('conserve une release sans asset APK', async () => {
    const local = await database();
    await saveUpdateCheckResult(local, '2026-08-10T09:00:00.000Z', {
      ...RELEASE,
      apkUrl: null,
    });

    const state = await readUpdateCheckState(local);
    expect(state.latestRelease).toEqual({ ...RELEASE, apkUrl: null });
  });

  it('note la vérification sans effacer la release connue quand GitHub échoue', async () => {
    const local = await database();
    await saveUpdateCheckResult(local, '2026-08-10T09:00:00.000Z', RELEASE);
    await saveUpdateCheckResult(local, '2026-08-10T18:00:00.000Z', null);

    await expect(readUpdateCheckState(local)).resolves.toEqual({
      lastCheckedAt: '2026-08-10T18:00:00.000Z',
      latestRelease: RELEASE,
      postponement: null,
    });
  });

  it('mémorise la version reportée et la date du report', async () => {
    const local = await database();
    await savePostponedVersion(local, '1.0.42', '2026-08-10T09:00:00.000Z');

    const state = await readUpdateCheckState(local);
    expect(state.postponement).toEqual({
      version: '1.0.42',
      postponedAt: '2026-08-10T09:00:00.000Z',
    });
  });
});
