/**
 * Cache local de la détection de nouvelle version.
 *
 * Il n'enregistre que des informations publiques (dernière release connue) et le
 * report choisi par l'utilisatrice. Aucune donnée de santé n'y transite.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import type { PublishedRelease } from '@/domain/updates/github-release';
import type { UpdatePostponement } from '@/domain/updates/update-notice';

export interface UpdateCheckState {
  readonly lastCheckedAt: string | null;
  readonly latestRelease: PublishedRelease | null;
  readonly postponement: UpdatePostponement | null;
}

interface UpdateCheckRow {
  readonly last_checked_at: string | null;
  readonly latest_version: string | null;
  readonly latest_release_url: string | null;
  readonly latest_apk_url: string | null;
  readonly postponed_version: string | null;
  readonly postponed_at: string | null;
}

export async function readUpdateCheckState(
  database: SQLiteDatabase,
): Promise<UpdateCheckState> {
  const row = await database.getFirstAsync<UpdateCheckRow>(
    `SELECT last_checked_at, latest_version, latest_release_url, latest_apk_url,
            postponed_version, postponed_at
     FROM update_check_settings WHERE singleton_id = 1`,
  );

  if (row === null) {
    return { lastCheckedAt: null, latestRelease: null, postponement: null };
  }

  return {
    lastCheckedAt: row.last_checked_at,
    latestRelease:
      row.latest_version !== null && row.latest_release_url !== null
        ? {
            version: row.latest_version,
            releaseUrl: row.latest_release_url,
            apkUrl: row.latest_apk_url,
          }
        : null,
    postponement:
      row.postponed_version !== null && row.postponed_at !== null
        ? { version: row.postponed_version, postponedAt: row.postponed_at }
        : null,
  };
}

/**
 * Mémorise la date de vérification, que GitHub ait répondu ou non : une panne
 * réseau ne doit pas déclencher une rafale de tentatives à chaque écran.
 * La release connue n'est remplacée que par une réponse valide.
 */
export async function saveUpdateCheckResult(
  database: SQLiteDatabase,
  checkedAt: string,
  release: PublishedRelease | null,
): Promise<void> {
  if (release === null) {
    await database.runAsync(
      `UPDATE update_check_settings
       SET last_checked_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE singleton_id = 1`,
      checkedAt,
    );
    return;
  }

  await database.runAsync(
    `UPDATE update_check_settings
     SET last_checked_at = ?, latest_version = ?, latest_release_url = ?,
         latest_apk_url = ?, updated_at = CURRENT_TIMESTAMP
     WHERE singleton_id = 1`,
    checkedAt,
    release.version,
    release.releaseUrl,
    release.apkUrl,
  );
}

export async function savePostponedVersion(
  database: SQLiteDatabase,
  version: string,
  postponedAt: string,
): Promise<void> {
  await database.runAsync(
    `UPDATE update_check_settings
     SET postponed_version = ?, postponed_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE singleton_id = 1`,
    version,
    postponedAt,
  );
}
