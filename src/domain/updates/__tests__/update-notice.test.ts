import { PUBLIC_APK_DOWNLOAD_URL } from '../apk-download';
import type { PublishedRelease } from '../github-release';
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_POSTPONEMENT_MS,
  decideUpdateNotice,
  shouldQueryGitHub,
} from '../update-notice';

const NOW = new Date('2026-08-10T09:00:00.000Z');

function release(overrides: Partial<PublishedRelease> = {}): PublishedRelease {
  return {
    version: '1.0.42',
    releaseUrl: 'https://github.com/PerrineLV/PillBox/releases/tag/v1.0.42',
    apkUrl:
      'https://github.com/PerrineLV/PillBox/releases/download/v1.0.42/pillbox-latest.apk',
    ...overrides,
  };
}

function decide(
  installedVersion: string | null,
  available: PublishedRelease | null,
  postponement: { version: string; postponedAt: string } | null = null,
  now: Date = NOW,
) {
  return decideUpdateNotice({
    installedVersion,
    release: available,
    postponement,
    now,
  });
}

describe('décision d’alerte de mise à jour', () => {
  it('n’alerte pas lorsque la version locale est celle de la dernière release', () => {
    expect(decide('1.0.42', release())).toBeNull();
  });

  it('alerte lorsque la release est plus récente', () => {
    expect(decide('1.0.41', release())).toEqual({
      version: '1.0.42',
      installedVersion: '1.0.41',
      downloadUrl: PUBLIC_APK_DOWNLOAD_URL,
      fallbackToReleasePage: false,
    });
  });

  it('n’alerte pas lorsque la version locale est plus récente', () => {
    expect(decide('1.0.43', release())).toBeNull();
    expect(decide('1.1.0', release())).toBeNull();
  });

  it('alerte pour 1.10.0 face à une version locale 1.9.0', () => {
    expect(decide('1.9.0', release({ version: '1.10.0' }))?.version).toBe(
      '1.10.0',
    );
    expect(decide('1.10.0', release({ version: '1.9.0' }))).toBeNull();
  });

  it('ouvre toujours le miroir public, même sans asset APK résolu', () => {
    const notice = decide('1.0.41', release({ apkUrl: null }));
    expect(notice?.downloadUrl).toBe(PUBLIC_APK_DOWNLOAD_URL);
    expect(notice?.fallbackToReleasePage).toBe(false);
  });

  it('n’alerte pas sans release connue ni sans version locale lisible', () => {
    expect(decide('1.0.41', null)).toBeNull();
    expect(decide(null, release())).toBeNull();
    expect(decide('inconnue', release())).toBeNull();
    expect(decide('1.0.41', release({ version: 'latest' }))).toBeNull();
  });
});

describe('report d’une version signalée', () => {
  const postponement = { version: '1.0.42', postponedAt: NOW.toISOString() };

  it('ne réaffiche pas immédiatement une version reportée', () => {
    expect(decide('1.0.41', release(), postponement)).toBeNull();
  });

  it('ne réaffiche pas pendant toute la temporisation', () => {
    const almostOver = new Date(NOW.getTime() + UPDATE_POSTPONEMENT_MS - 1000);
    expect(decide('1.0.41', release(), postponement, almostOver)).toBeNull();
  });

  it('réaffiche la même version une fois la temporisation écoulée', () => {
    const expired = new Date(NOW.getTime() + UPDATE_POSTPONEMENT_MS);
    expect(decide('1.0.41', release(), postponement, expired)?.version).toBe(
      '1.0.42',
    );
  });

  it('signale une release plus récente malgré le report de la précédente', () => {
    const newer = release({ version: '1.0.43' });
    expect(decide('1.0.41', newer, postponement)?.version).toBe('1.0.43');
  });

  it('signale aussi un saut de version mineure après un report', () => {
    const newer = release({ version: '1.1.0' });
    expect(decide('1.0.41', newer, postponement)?.version).toBe('1.1.0');
  });

  it('ignore un report illisible plutôt que de masquer une mise à jour', () => {
    expect(
      decide('1.0.41', release(), {
        version: '1.0.42',
        postponedAt: 'jamais',
      })?.version,
    ).toBe('1.0.42');
    expect(
      decide('1.0.41', release(), {
        version: 'illisible',
        postponedAt: NOW.toISOString(),
      })?.version,
    ).toBe('1.0.42');
  });
});

describe('limitation des appels réseau', () => {
  it('interroge GitHub lors de la toute première ouverture', () => {
    expect(shouldQueryGitHub(null, NOW)).toBe(true);
  });

  it('n’interroge pas GitHub avant la fin de l’intervalle', () => {
    const recent = new Date(NOW.getTime() - UPDATE_CHECK_INTERVAL_MS + 1000);
    expect(shouldQueryGitHub(recent.toISOString(), NOW)).toBe(false);
  });

  it('interroge GitHub une fois l’intervalle écoulé', () => {
    const old = new Date(NOW.getTime() - UPDATE_CHECK_INTERVAL_MS);
    expect(shouldQueryGitHub(old.toISOString(), NOW)).toBe(true);
  });

  it('ne se bloque pas sur une date illisible ou future', () => {
    expect(shouldQueryGitHub('pas une date', NOW)).toBe(true);
    const future = new Date(NOW.getTime() + 60_000);
    expect(shouldQueryGitHub(future.toISOString(), NOW)).toBe(true);
  });
});
