import { APK_ASSET_NAME, parsePublishedRelease } from '../github-release';

const RELEASE_URL = 'https://github.com/PerrineLV/PillBox/releases/tag/v1.0.42';
const APK_URL =
  'https://github.com/PerrineLV/PillBox/releases/download/v1.0.42/pillbox-latest.apk';

function release(overrides: Record<string, unknown> = {}): unknown {
  return {
    tag_name: 'v1.0.42',
    draft: false,
    prerelease: false,
    html_url: RELEASE_URL,
    assets: [
      {
        name: APK_ASSET_NAME,
        state: 'uploaded',
        browser_download_url: APK_URL,
      },
      {
        name: 'pillbox-latest.apk.sha256',
        state: 'uploaded',
        browser_download_url: `${APK_URL}.sha256`,
      },
    ],
    ...overrides,
  };
}

describe('lecture de la dernière release publiée', () => {
  it('résout la version et le lien direct de l’APK du workflow 01f', () => {
    expect(parsePublishedRelease(release())).toEqual({
      version: '1.0.42',
      releaseUrl: RELEASE_URL,
      apkUrl: APK_URL,
    });
  });

  it('normalise le tag préfixé par v', () => {
    expect(
      parsePublishedRelease(release({ tag_name: '1.0.42' }))?.version,
    ).toBe('1.0.42');
  });

  it('ignore un brouillon et une préversion', () => {
    expect(parsePublishedRelease(release({ draft: true }))).toBeNull();
    expect(parsePublishedRelease(release({ prerelease: true }))).toBeNull();
  });

  it('replie sur la page de release quand l’APK est absent', () => {
    const withoutApk = parsePublishedRelease(release({ assets: [] }));
    expect(withoutApk).toEqual({
      version: '1.0.42',
      releaseUrl: RELEASE_URL,
      apkUrl: null,
    });
  });

  it('ignore un asset APK encore en cours d’envoi', () => {
    const uploading = parsePublishedRelease(
      release({
        assets: [
          {
            name: APK_ASSET_NAME,
            state: 'starter',
            browser_download_url: APK_URL,
          },
        ],
      }),
    );
    expect(uploading?.apkUrl).toBeNull();
    expect(uploading?.releaseUrl).toBe(RELEASE_URL);
  });

  it('refuse un lien hors du dépôt PillBox', () => {
    expect(
      parsePublishedRelease(release({ html_url: 'https://example.com/x' })),
    ).toBeNull();
    expect(
      parsePublishedRelease(release({ html_url: 'http://github.com/x' })),
    ).toBeNull();
    expect(
      parsePublishedRelease(
        release({ html_url: 'https://github.com/autre/depot/releases' }),
      ),
    ).toBeNull();

    const foreignAsset = parsePublishedRelease(
      release({
        assets: [
          {
            name: APK_ASSET_NAME,
            state: 'uploaded',
            browser_download_url: 'https://malveillant.example/pillbox.apk',
          },
        ],
      }),
    );
    expect(foreignAsset?.apkUrl).toBeNull();
  });

  it.each([
    null,
    undefined,
    'indisponible',
    42,
    [],
    {},
    { tag_name: 'android-9f2c1ab', html_url: RELEASE_URL },
    { tag_name: 'v1.0.42' },
    { tag_name: 'v1.0.42', html_url: 42 },
  ])('refuse la réponse GitHub invalide %p', (payload) => {
    expect(parsePublishedRelease(payload)).toBeNull();
  });

  it('tolère un champ assets inattendu sans échouer', () => {
    expect(parsePublishedRelease(release({ assets: 'nope' }))).toEqual({
      version: '1.0.42',
      releaseUrl: RELEASE_URL,
      apkUrl: null,
    });
  });
});
