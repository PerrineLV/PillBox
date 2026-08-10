/**
 * Lecture défensive de la dernière GitHub Release publiée par le workflow 01f.
 *
 * Aucune donnée reçue de GitHub n'est traitée comme fiable : une réponse
 * inattendue, un brouillon, une préversion ou une URL hors du dépôt PillBox
 * n'aboutissent jamais à une alerte ni à l'ouverture d'un lien.
 */
import {
  formatSemanticVersion,
  parseSemanticVersion,
} from './semantic-version';

export const GITHUB_REPOSITORY = 'PerrineLV/PillBox';

/**
 * L'endpoint `releases/latest` exclut déjà les brouillons et les préversions.
 * Le workflow n'en publie aucun ; la vérification explicite ci-dessous garantit
 * qu'un changement de pipeline ne proposerait pas silencieusement une préversion.
 */
export const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;

/** Nom stable imposé par le ticket 01f à l'asset APK de chaque release. */
export const APK_ASSET_NAME = 'pillbox-latest.apk';

export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPOSITORY}/releases/latest`;

export interface PublishedRelease {
  /** Version normalisée, sans préfixe `v`. */
  readonly version: string;
  /** Page de la release, toujours renseignée : c'est le repli sûr. */
  readonly releaseUrl: string;
  /** Lien direct de l'APK lorsqu'il est publié et vérifiable, sinon `null`. */
  readonly apkUrl: string | null;
}

export function parsePublishedRelease(
  payload: unknown,
): PublishedRelease | null {
  if (!isRecord(payload)) return null;
  if (payload.draft === true || payload.prerelease === true) return null;

  const version = parseSemanticVersion(payload.tag_name);
  if (version === null) return null;

  const releaseUrl = repositoryUrl(payload.html_url, 'github.com');
  if (releaseUrl === null) return null;

  return {
    version: formatSemanticVersion(version),
    releaseUrl,
    apkUrl: findApkAssetUrl(payload.assets),
  };
}

function findApkAssetUrl(assets: unknown): string | null {
  if (!Array.isArray(assets)) return null;

  for (const asset of assets) {
    if (!isRecord(asset) || asset.name !== APK_ASSET_NAME) continue;
    // Un asset encore en cours d'envoi ne doit pas être proposé.
    if (asset.state !== undefined && asset.state !== 'uploaded') continue;

    const url = repositoryUrl(asset.browser_download_url, 'github.com');
    if (url !== null) return url;
  }

  return null;
}

/**
 * N'accepte qu'une URL HTTPS appartenant au dépôt PillBox : une réponse altérée
 * ne peut donc jamais faire ouvrir un lien arbitraire à l'utilisatrice.
 */
function repositoryUrl(value: unknown, expectedHost: string): string | null {
  if (typeof value !== 'string') return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.host !== expectedHost) return null;
  return url.pathname.startsWith(`/${GITHUB_REPOSITORY}/`)
    ? url.toString()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
