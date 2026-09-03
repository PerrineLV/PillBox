// Ce fichier est évalué par Expo sans résolution des imports relatifs :
// toute la logique de version doit rester ici, sans module externe.
import type { ConfigContext, ExpoConfig } from 'expo/config';

const DEFAULT_ANDROID_VERSION_CODE = 1;
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;
const VERSION_LINE_PATTERN = /^(\d+)\.(\d+)\.0$/;
// Dupliqué depuis colors.brand (src/ui/theme.ts) : ce fichier n'a pas de résolution
// des imports relatifs (voir commentaire en tête de fichier).
const DATE_TIME_PICKER_ACCENT_COLOR = '#376B5B';

export default ({ config }: ConfigContext): ExpoConfig => {
  const versionCode = resolveAndroidVersionCode(
    process.env.ANDROID_VERSION_CODE,
  );
  return {
    ...config,
    name: config.name ?? 'PillBox',
    slug: config.slug ?? 'pillbox',
    // Version publiée = ligne produit de app.json + versionCode Android.
    // Cette valeur alimente le versionName Android et le tag GitHub Release.
    version: resolveAppVersion(config.version, versionCode),
    android: {
      ...config.android,
      allowBackup: false,
      package: 'com.perrinelv.pillbox',
      permissions: appendValue(
        config.android?.permissions,
        'android.permission.SCHEDULE_EXACT_ALARM',
      ),
      versionCode,
    },
    plugins: ADDED_PLUGINS.reduce(appendPlugin, config.plugins ?? []),
  };
};

/**
 * Options du sélecteur natif de date et d'heure.
 *
 * Aucune variante sombre n'est déclarée : les deux sélecteurs sont fixés en
 * clair, comme le reste de PillBox. Une couleur absente de `values-night`
 * retombe sur `values`, donc sur ces teintes-ci quel que soit le mode du
 * téléphone ; `withAndroidLightTheme` fait de même pour le cadre de la boîte
 * de dialogue, qui hérite sinon du thème de l'application.
 */
const DATE_TIME_PICKER_OPTIONS = {
  android: {
    datePicker: {
      colorAccent: { light: DATE_TIME_PICKER_ACCENT_COLOR },
    },
    timePicker: {
      numbersSelectorColor: { light: DATE_TIME_PICKER_ACCENT_COLOR },
      headerBackground: { light: DATE_TIME_PICKER_ACCENT_COLOR },
      // Sans ces trois attributs, le cadran hérite du style AOSP par défaut,
      // dont le contraste des chiffres non sélectionnés varie fortement selon
      // la version d'Android et la surcouche du fabricant (ticket 43).
      // Valeurs choisies à la main, à valider visuellement sur un appareil
      // réel.
      background: { light: '#FFFDF9' },
      numbersBackgroundColor: { light: '#F3EFE6' },
      numbersTextColor: { light: '#24322D' },
    },
  },
};

/** Ajoutés à ceux de `app.json`, dans l'ordre, sans doublon. */
const ADDED_PLUGINS: readonly (string | [string, unknown])[] = [
  'expo-notifications',
  'expo-local-authentication',
  'expo-mail-composer',
  ['@react-native-community/datetimepicker', DATE_TIME_PICKER_OPTIONS],
  './plugins/withAndroidLightTheme',
  './plugins/withPillBoxTodayWidget',
];

function appendValue(
  values: readonly string[] | undefined,
  value: string,
): string[] {
  return values?.includes(value) ? [...values] : [...(values ?? []), value];
}

function appendPlugin(
  plugins: ExpoConfig['plugins'],
  plugin: string | [string, unknown],
): NonNullable<ExpoConfig['plugins']> {
  const configured = plugins ?? [];
  const name = typeof plugin === 'string' ? plugin : plugin[0];
  return configured.some((entry) =>
    typeof entry === 'string' ? entry === name : entry[0] === name,
  )
    ? configured
    : [...configured, plugin];
}

/**
 * Convention de version PillBox.
 *
 * `app.json` déclare la ligne produit sous la forme `MAJEUR.MINEUR.0`. Le numéro
 * de build est le `versionCode` Android, lui-même égal au numéro de run GitHub
 * Actions. La version publiée vaut donc `MAJEUR.MINEUR.<versionCode>` :
 *
 * - `expo.version` → versionName Android → tag GitHub `v<version>` ;
 * - le patch de la version est toujours le `versionCode` Android.
 *
 * Seuls `MAJEUR` et `MINEUR` se saisissent à la main ; le patch de `app.json`
 * reste `0` afin qu'aucune version ne soit dupliquée dans deux fichiers.
 */
export function resolveAppVersion(
  declaredVersion: string | undefined,
  androidVersionCode: number,
): string {
  if (declaredVersion === undefined) {
    throw new Error('La version de l’application est absente de app.json.');
  }

  const versionLine = VERSION_LINE_PATTERN.exec(declaredVersion);
  if (versionLine === null) {
    throw new Error(
      `La version déclarée « ${declaredVersion} » doit suivre la forme MAJEUR.MINEUR.0 : ` +
        'le patch est toujours le versionCode Android et ne se saisit pas à la main.',
    );
  }

  if (!Number.isSafeInteger(androidVersionCode) || androidVersionCode < 1) {
    throw new Error(
      'Le versionCode Android doit être un entier positif pour composer la version publiée.',
    );
  }

  return `${versionLine[1]}.${versionLine[2]}.${androidVersionCode}`;
}

export function resolveAndroidVersionCode(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_ANDROID_VERSION_CODE;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error('ANDROID_VERSION_CODE doit être un entier positif.');
  }

  const versionCode = Number(value);
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode < 1 ||
    versionCode > MAX_ANDROID_VERSION_CODE
  ) {
    throw new Error(
      `ANDROID_VERSION_CODE doit être compris entre 1 et ${MAX_ANDROID_VERSION_CODE}.`,
    );
  }

  return versionCode;
}
