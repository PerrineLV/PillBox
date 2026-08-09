import type { ConfigContext, ExpoConfig } from 'expo/config';

const DEFAULT_ANDROID_VERSION_CODE = 1;
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'PillBox',
  slug: config.slug ?? 'pillbox',
  android: {
    ...config.android,
    package: 'com.perrinelv.pillbox',
    permissions: appendValue(
      config.android?.permissions,
      'android.permission.SCHEDULE_EXACT_ALARM',
    ),
    versionCode: resolveAndroidVersionCode(process.env.ANDROID_VERSION_CODE),
  },
  plugins: appendPlugin(config.plugins, 'expo-notifications'),
});

function appendValue(
  values: readonly string[] | undefined,
  value: string,
): string[] {
  return values?.includes(value) ? [...values] : [...(values ?? []), value];
}

function appendPlugin(
  plugins: ExpoConfig['plugins'],
  plugin: string,
): NonNullable<ExpoConfig['plugins']> {
  const configured = plugins ?? [];
  return configured.some((entry) =>
    typeof entry === 'string' ? entry === plugin : entry[0] === plugin,
  )
    ? configured
    : [...configured, plugin];
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
