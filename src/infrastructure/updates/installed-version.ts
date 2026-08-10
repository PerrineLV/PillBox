import Constants from 'expo-constants';

/**
 * Version réellement installée, lue dans les métadonnées de build Expo.
 *
 * `app.config.ts` compose cette valeur à partir de la ligne produit de
 * `app.json` et du `versionCode` Android : elle est donc identique au
 * versionName de l'APK et au tag `v<version>` de la GitHub Release.
 */
export function installedAppVersion(): string | null {
  const version = Constants.expoConfig?.version;
  return typeof version === 'string' && version.length > 0 ? version : null;
}
