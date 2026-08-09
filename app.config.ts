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
    versionCode: resolveAndroidVersionCode(process.env.ANDROID_VERSION_CODE),
  },
});

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
