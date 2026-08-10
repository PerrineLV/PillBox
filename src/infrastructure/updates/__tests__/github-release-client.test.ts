import { GITHUB_LATEST_RELEASE_URL } from '@/domain/updates/github-release';

import { fetchLatestPublishedRelease } from '../github-release-client';

const RELEASE_URL = 'https://github.com/PerrineLV/PillBox/releases/tag/v1.0.42';
const APK_URL =
  'https://github.com/PerrineLV/PillBox/releases/download/v1.0.42/pillbox-latest.apk';

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

describe('appel de l’API publique GitHub', () => {
  it('interroge l’endpoint des dernières releases sans jeton', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse({
        tag_name: 'v1.0.42',
        html_url: RELEASE_URL,
        assets: [{ name: 'pillbox-latest.apk', browser_download_url: APK_URL }],
      }),
    );

    const release = await fetchLatestPublishedRelease({ fetchImpl });

    expect(release).toEqual({
      version: '1.0.42',
      releaseUrl: RELEASE_URL,
      apkUrl: APK_URL,
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(GITHUB_LATEST_RELEASE_URL);
    expect(init.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
    });
    expect(JSON.stringify(init)).not.toContain('Authorization');
  });

  it('retourne null hors ligne sans propager d’erreur', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(new TypeError('Network request failed'));
    await expect(
      fetchLatestPublishedRelease({ fetchImpl }),
    ).resolves.toBeNull();
  });

  it('retourne null lorsque la requête dépasse le délai', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('Aborted')),
        );
      });

    await expect(
      fetchLatestPublishedRelease({ fetchImpl, timeoutMs: 5 }),
    ).resolves.toBeNull();
  });

  it('retourne null sur une réponse en erreur ou un JSON illisible', async () => {
    await expect(
      fetchLatestPublishedRelease({
        fetchImpl: jest.fn().mockResolvedValue(jsonResponse({}, false)),
      }),
    ).resolves.toBeNull();

    await expect(
      fetchLatestPublishedRelease({
        fetchImpl: jest.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.reject(new SyntaxError('Unexpected token')),
        } as unknown as Response),
      }),
    ).resolves.toBeNull();
  });

  it('retourne null lorsque fetch n’existe pas dans l’environnement', async () => {
    await expect(
      fetchLatestPublishedRelease({
        fetchImpl: undefined as unknown as typeof fetch,
      }),
    ).resolves.toBeNull();
  });

  it('retourne null sur une réponse GitHub structurellement invalide', async () => {
    await expect(
      fetchLatestPublishedRelease({
        fetchImpl: jest
          .fn()
          .mockResolvedValue(jsonResponse({ message: 'Not Found' })),
      }),
    ).resolves.toBeNull();
  });
});
