/**
 * Orchestration de la détection de nouvelle version.
 *
 * Le réseau n'est sollicité qu'au-delà de `UPDATE_CHECK_INTERVAL_MS` ; entre deux
 * appels, la dernière release connue suffit à décider. Toute défaillance se
 * traduit par l'absence d'alerte, jamais par une erreur remontée à l'UI.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { PublishedRelease } from '@/domain/updates/github-release';
import {
  decideUpdateNotice,
  shouldQueryGitHub,
  type UpdateNotice,
} from '@/domain/updates/update-notice';

import { fetchLatestPublishedRelease } from './github-release-client';
import { installedAppVersion } from './installed-version';
import {
  readUpdateCheckState,
  savePostponedVersion,
  saveUpdateCheckResult,
  type UpdateCheckState,
} from './update-check-repository';

export interface UpdateCheckDependencies {
  readonly readState: () => Promise<UpdateCheckState>;
  readonly saveResult: (
    checkedAt: string,
    release: PublishedRelease | null,
  ) => Promise<void>;
  readonly fetchRelease: () => Promise<PublishedRelease | null>;
  readonly installedVersion: string | null;
  readonly now: Date;
}

export async function resolveUpdateNotice({
  readState,
  saveResult,
  fetchRelease,
  installedVersion,
  now,
}: UpdateCheckDependencies): Promise<UpdateNotice | null> {
  const state = await readState();
  let release = state.latestRelease;

  if (shouldQueryGitHub(state.lastCheckedAt, now)) {
    const fetched = await fetchRelease();
    await saveResult(now.toISOString(), fetched);
    // Une réponse invalide laisse le cache intact plutôt que d'effacer une
    // release déjà connue.
    release = fetched ?? release;
  }

  return decideUpdateNotice({
    installedVersion,
    release,
    postponement: state.postponement,
    now,
  });
}

/**
 * Point d'entrée applicatif : ne lève jamais, afin qu'aucun incident de mise à
 * jour n'empêche l'ouverture ou l'usage de PillBox.
 */
export async function checkForUpdate(
  database: SQLiteDatabase,
  now: Date = new Date(),
): Promise<UpdateNotice | null> {
  try {
    return await resolveUpdateNotice({
      readState: () => readUpdateCheckState(database),
      saveResult: (checkedAt, release) =>
        saveUpdateCheckResult(database, checkedAt, release),
      fetchRelease: () => fetchLatestPublishedRelease(),
      installedVersion: installedAppVersion(),
      now,
    });
  } catch {
    return null;
  }
}

export async function postponeUpdate(
  database: SQLiteDatabase,
  version: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    await savePostponedVersion(database, version, now.toISOString());
  } catch {
    // Le report n'est qu'un confort : son échec ne doit rien interrompre.
  }
}
