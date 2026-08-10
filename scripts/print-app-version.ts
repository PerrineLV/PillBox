/**
 * Affiche la version publiée de PillBox sur la sortie standard.
 *
 * Le workflow de release s'en sert pour nommer le tag GitHub (`v<version>`) et
 * le titre de la release, à partir exactement de la même règle que la
 * configuration Expo. Aucune version n'est donc saisie deux fois.
 */
import appJson from '../app.json';
import { resolveAndroidVersionCode, resolveAppVersion } from '../app.config';

const version = resolveAppVersion(
  appJson.expo.version,
  resolveAndroidVersionCode(process.env.ANDROID_VERSION_CODE),
);

process.stdout.write(`${version}\n`);
