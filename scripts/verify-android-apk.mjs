import { spawnSync } from 'node:child_process';
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

try {
  const apkPath = resolve(
    process.argv[2] ?? 'android/app/build/outputs/apk/release/app-release.apk',
  );
  const apksignerPath = await findApksigner();
  const verification = spawnSync(
    apksignerPath,
    ['verify', '--verbose', '--print-certs', apkPath],
    { stdio: 'inherit' },
  );

  if (verification.error !== undefined) {
    throw verification.error;
  }
  if (verification.status !== 0) {
    throw new Error(
      `La vérification de signature APK a échoué avec le code ${verification.status}.`,
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`::error title=Vérification APK::${message}`);
  process.exitCode = 1;
}

async function findApksigner() {
  const androidSdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (!androidSdk) {
    throw new Error('ANDROID_HOME ou ANDROID_SDK_ROOT doit être défini.');
  }

  const buildToolsPath = join(androidSdk, 'build-tools');
  const entries = await readdir(buildToolsPath, { withFileTypes: true });
  const versions = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true }),
    );

  for (const version of versions) {
    const candidate = join(buildToolsPath, version, 'apksigner');
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue jusqu’à la prochaine version des build-tools.
    }
  }

  throw new Error('apksigner est introuvable dans les Android build-tools.');
}
