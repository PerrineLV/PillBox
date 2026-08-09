import { spawnSync } from 'node:child_process';
import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

try {
  const apkPath = resolve(
    process.argv[2] ?? 'android/app/build/outputs/apk/release/app-release.apk',
  );
  await verifyApkFile(apkPath);
  inspectArchiveEntries(apkPath);
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

async function verifyApkFile(apkPath) {
  const apk = await stat(apkPath);
  if (!apk.isFile() || apk.size === 0) {
    throw new Error('L’APK release est absent ou vide.');
  }

  const zipTest = spawnSync('unzip', ['-tqq', apkPath], { encoding: 'utf8' });
  if (zipTest.error !== undefined) {
    throw new Error('Impossible d’inspecter la structure ZIP de l’APK.');
  }
  if (zipTest.status !== 0) {
    throw new Error('L’APK release n’est pas une archive ZIP Android valide.');
  }
}

function inspectArchiveEntries(apkPath) {
  const listing = spawnSync('unzip', ['-Z1', apkPath], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (listing.error !== undefined || listing.status !== 0) {
    throw new Error('La liste des fichiers inclus dans l’APK est illisible.');
  }

  const sensitiveEntry =
    /(^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:jks|keystore|p12|p8|pem|key|mobileprovision|base64)|google-services\.json|local\.properties|gradle\.properties|credentials[^/]*\.json|secrets?[^/]*\.json|pillbox-(?:sauvegarde|avant-restauration)[^/]*\.json)$/i;
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  if (entries.some((entry) => sensitiveEntry.test(entry))) {
    throw new Error(
      'L’APK contient au moins un fichier dont le nom indique un secret, un keystore ou une sauvegarde locale. Publication refusée.',
    );
  }

  console.log(
    `Structure APK lisible et ${entries.length} entrées contrôlées par nom. Ce contrôle ciblé ne prouve pas l’absence totale de secrets.`,
  );
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
