/**
 * Comparaison sémantique des versions PillBox.
 *
 * Les tags de release peuvent porter un préfixe `v` : il est toléré et retiré.
 * La comparaison est numérique composant par composant, jamais lexicographique,
 * afin que 1.10.0 soit bien reconnue comme plus récente que 1.9.0.
 */

const VERSION_PATTERN =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const NUMERIC_IDENTIFIER = /^\d+$/;

export interface SemanticVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Identifiants de préversion ; vide pour une version stable. */
  readonly prerelease: readonly string[];
}

/** Retourne `null` plutôt que de deviner lorsqu'une version est illisible. */
export function parseSemanticVersion(value: unknown): SemanticVersion | null {
  if (typeof value !== 'string') return null;

  const parsed = VERSION_PATTERN.exec(value.trim());
  if (parsed === null) return null;

  const [major, minor, patch] = [parsed[1], parsed[2], parsed[3]].map(Number);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    return null;
  }

  const prerelease = parsed[4] === undefined ? [] : parsed[4].split('.');
  if (prerelease.some((identifier) => identifier.length === 0)) return null;

  return { major, minor, patch, prerelease };
}

/** Négatif si `left` précède `right`, positif s'il la suit, 0 si équivalentes. */
export function compareSemanticVersions(
  left: SemanticVersion,
  right: SemanticVersion,
): number {
  const core =
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch;
  if (core !== 0) return core;

  // Une préversion précède toujours la version stable correspondante.
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const shared = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = compareIdentifiers(
      left.prerelease[index],
      right.prerelease[index],
    );
    if (difference !== 0) return difference;
  }

  return left.prerelease.length - right.prerelease.length;
}

/**
 * `true` uniquement lorsque les deux versions sont lisibles et que la version
 * candidate est strictement plus récente. Une version illisible n'alerte jamais.
 */
export function isStrictlyNewerVersion(
  candidate: unknown,
  installed: unknown,
): boolean {
  const parsedCandidate = parseSemanticVersion(candidate);
  const parsedInstalled = parseSemanticVersion(installed);
  if (parsedCandidate === null || parsedInstalled === null) return false;
  return compareSemanticVersions(parsedCandidate, parsedInstalled) > 0;
}

/** Version normalisée sans préfixe `v`, telle qu'affichée et mémorisée. */
export function formatSemanticVersion(version: SemanticVersion): string {
  const core = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease.length === 0
    ? core
    : `${core}-${version.prerelease.join('.')}`;
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = NUMERIC_IDENTIFIER.test(left);
  const rightNumeric = NUMERIC_IDENTIFIER.test(right);

  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  // Un identifiant numérique précède toujours un identifiant alphanumérique.
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}
