import type { PublishedRelease } from '@/domain/updates/github-release';
import { UPDATE_CHECK_INTERVAL_MS } from '@/domain/updates/update-notice';

import type { UpdateCheckState } from '../update-check-repository';
import { resolveUpdateNotice } from '../update-check-service';

const NOW = new Date('2026-08-10T09:00:00.000Z');

const RELEASE: PublishedRelease = {
  version: '1.0.42',
  releaseUrl: 'https://github.com/PerrineLV/PillBox/releases/tag/v1.0.42',
  apkUrl:
    'https://github.com/PerrineLV/PillBox/releases/download/v1.0.42/pillbox-latest.apk',
};

const EMPTY_STATE: UpdateCheckState = {
  lastCheckedAt: null,
  latestRelease: null,
  postponement: null,
};

function run({
  state = EMPTY_STATE,
  fetched = RELEASE,
  installedVersion = '1.0.41',
  fetchRelease,
}: {
  state?: UpdateCheckState;
  fetched?: PublishedRelease | null;
  installedVersion?: string | null;
  fetchRelease?: jest.Mock;
} = {}) {
  const saveResult = jest.fn().mockResolvedValue(undefined);
  const fetcher = fetchRelease ?? jest.fn().mockResolvedValue(fetched);
  const notice = resolveUpdateNotice({
    readState: () => Promise.resolve(state),
    saveResult,
    fetchRelease: fetcher,
    installedVersion,
    now: NOW,
  });
  return { notice, saveResult, fetchRelease: fetcher };
}

describe('orchestration de la détection de version', () => {
  it('interroge GitHub à la première ouverture et signale la nouvelle version', async () => {
    const { notice, fetchRelease, saveResult } = run();

    expect(await notice).toMatchObject({ version: '1.0.42' });
    expect(fetchRelease).toHaveBeenCalledTimes(1);
    expect(saveResult).toHaveBeenCalledWith(NOW.toISOString(), RELEASE);
  });

  it('n’appelle pas le réseau tant que l’intervalle n’est pas écoulé', async () => {
    const recent = new Date(NOW.getTime() - UPDATE_CHECK_INTERVAL_MS + 1000);
    const { notice, fetchRelease, saveResult } = run({
      state: {
        lastCheckedAt: recent.toISOString(),
        latestRelease: RELEASE,
        postponement: null,
      },
    });

    // La release en cache suffit à décider : aucun appel réseau supplémentaire.
    expect(await notice).toMatchObject({ version: '1.0.42' });
    expect(fetchRelease).not.toHaveBeenCalled();
    expect(saveResult).not.toHaveBeenCalled();
  });

  it('mémorise la date de vérification même quand GitHub ne répond pas', async () => {
    const { notice, saveResult } = run({ fetched: null });

    expect(await notice).toBeNull();
    expect(saveResult).toHaveBeenCalledWith(NOW.toISOString(), null);
  });

  it('conserve la release connue lorsque GitHub échoue', async () => {
    const { notice } = run({
      state: {
        lastCheckedAt: '2026-08-01T09:00:00.000Z',
        latestRelease: RELEASE,
        postponement: null,
      },
      fetched: null,
    });

    expect(await notice).toMatchObject({ version: '1.0.42' });
  });

  it('n’alerte pas lorsque la version installée est la dernière publiée', async () => {
    expect(await run({ installedVersion: '1.0.42' }).notice).toBeNull();
  });

  it('n’alerte pas lorsqu’une version reportée reste la plus récente', async () => {
    const { notice } = run({
      state: {
        lastCheckedAt: null,
        latestRelease: null,
        postponement: {
          version: '1.0.42',
          postponedAt: NOW.toISOString(),
        },
      },
    });

    expect(await notice).toBeNull();
  });

  it('alerte de nouveau lorsqu’une release paraît après un report', async () => {
    const { notice } = run({
      state: {
        lastCheckedAt: null,
        latestRelease: null,
        postponement: {
          version: '1.0.42',
          postponedAt: NOW.toISOString(),
        },
      },
      fetched: { ...RELEASE, version: '1.0.43' },
    });

    expect(await notice).toMatchObject({ version: '1.0.43' });
  });
});
