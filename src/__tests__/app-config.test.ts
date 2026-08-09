import buildConfig, { resolveAndroidVersionCode } from '../../app.config';

describe('durcissement de la configuration Android', () => {
  it('exclut explicitement toutes les données de la sauvegarde Android', () => {
    const config = buildConfig({ config: {} } as Parameters<
      typeof buildConfig
    >[0]);
    expect(config.android?.allowBackup).toBe(false);
    expect(config.plugins).toContain('expo-local-authentication');
  });
});

describe('resolveAndroidVersionCode', () => {
  it('utilise la version initiale hors CI', () => {
    expect(resolveAndroidVersionCode(undefined)).toBe(1);
  });

  it('accepte un numéro de run GitHub valide', () => {
    expect(resolveAndroidVersionCode('42')).toBe(42);
  });

  it.each(['0', '-1', '1.5', 'abc', '2100000001'])(
    'refuse le versionCode invalide %s',
    (versionCode) => {
      expect(() => resolveAndroidVersionCode(versionCode)).toThrow(
        'ANDROID_VERSION_CODE',
      );
    },
  );
});
