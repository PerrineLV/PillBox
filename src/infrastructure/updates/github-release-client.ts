/**
 * Appel de l'API publique GitHub, sans jeton ni donnée personnelle envoyée.
 *
 * La fonction ne rejette jamais : hors ligne, délai dépassé, quota atteint ou
 * réponse inattendue produisent `null`. Aucun corps de réponse ni détail
 * d'erreur n'est journalisé.
 */
import {
  GITHUB_LATEST_RELEASE_URL,
  parsePublishedRelease,
  type PublishedRelease,
} from '@/domain/updates/github-release';

export const GITHUB_REQUEST_TIMEOUT_MS = 8000;

export type FetchLike = typeof fetch;

export async function fetchLatestPublishedRelease({
  fetchImpl = globalThis.fetch,
  timeoutMs = GITHUB_REQUEST_TIMEOUT_MS,
}: {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
} = {}): Promise<PublishedRelease | null> {
  if (typeof fetchImpl !== 'function') return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;
    return parsePublishedRelease(await response.json());
  } catch {
    // Hors ligne, délai dépassé ou JSON illisible : PillBox reste utilisable.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
