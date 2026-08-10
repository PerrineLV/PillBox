/**
 * Politique d'alerte de nouvelle version.
 *
 * Les deux temporisations ci-dessous sont les seuls réglages du mécanisme :
 * elles sont centralisées ici et s'ajustent d'une seule valeur.
 */
import type { PublishedRelease } from './github-release';
import {
  compareSemanticVersions,
  parseSemanticVersion,
} from './semantic-version';

/**
 * Fréquence maximale d'appel à l'API GitHub. Entre deux appels, l'alerte
 * s'appuie sur la dernière release connue en cache local : PillBox n'interroge
 * donc jamais le réseau à chaque changement d'écran.
 */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 heures

/**
 * Durée pendant laquelle une version explicitement reportée n'est plus
 * signalée. Une release ultérieure reste annoncée immédiatement.
 */
export const UPDATE_POSTPONEMENT_MS = 3 * 24 * 60 * 60 * 1000; // 3 jours

export interface UpdatePostponement {
  readonly version: string;
  /** Date ISO du report. */
  readonly postponedAt: string;
}

export interface UpdateNotice {
  readonly version: string;
  readonly installedVersion: string;
  /** Lien ouvert par « Télécharger » : APK publié, sinon page de la release. */
  readonly downloadUrl: string;
  /** `true` lorsque l'APK n'a pas pu être résolu et que le repli est utilisé. */
  readonly fallbackToReleasePage: boolean;
}

export function shouldQueryGitHub(
  lastCheckedAt: string | null,
  now: Date,
): boolean {
  if (lastCheckedAt === null) return true;

  const checkedAt = Date.parse(lastCheckedAt);
  // Une date illisible ou future ne doit pas geler les vérifications.
  if (Number.isNaN(checkedAt)) return true;

  const elapsed = now.getTime() - checkedAt;
  return elapsed < 0 || elapsed >= UPDATE_CHECK_INTERVAL_MS;
}

/**
 * Retourne l'alerte à afficher, ou `null` quand PillBox est à jour, quand la
 * version distante est illisible ou quand elle a été reportée récemment.
 */
export function decideUpdateNotice({
  installedVersion,
  release,
  postponement,
  now,
}: {
  installedVersion: string | null;
  release: PublishedRelease | null;
  postponement: UpdatePostponement | null;
  now: Date;
}): UpdateNotice | null {
  if (release === null || installedVersion === null) return null;

  const available = parseSemanticVersion(release.version);
  const installed = parseSemanticVersion(installedVersion);
  if (available === null || installed === null) return null;
  if (compareSemanticVersions(available, installed) <= 0) return null;

  if (isStillPostponed(release.version, postponement, now)) return null;

  return {
    version: release.version,
    installedVersion,
    downloadUrl: release.apkUrl ?? release.releaseUrl,
    fallbackToReleasePage: release.apkUrl === null,
  };
}

function isStillPostponed(
  availableVersion: string,
  postponement: UpdatePostponement | null,
  now: Date,
): boolean {
  if (postponement === null) return false;

  const postponed = parseSemanticVersion(postponement.version);
  const available = parseSemanticVersion(availableVersion);
  if (postponed === null || available === null) return false;

  // Une release plus récente que celle reportée est signalée sans attendre.
  if (compareSemanticVersions(available, postponed) > 0) return false;

  const postponedAt = Date.parse(postponement.postponedAt);
  if (Number.isNaN(postponedAt)) return false;

  const elapsed = now.getTime() - postponedAt;
  return elapsed >= 0 && elapsed < UPDATE_POSTPONEMENT_MS;
}
