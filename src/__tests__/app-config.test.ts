import appJson from '../../app.json';
import buildConfig, {
  resolveAndroidVersionCode,
  resolveAppVersion,
} from '../../app.config';

function buildWith(version: string) {
  return buildConfig({ config: { version } } as Parameters<
    typeof buildConfig
  >[0]);
}

describe('durcissement de la configuration Android', () => {
  it('exclut explicitement toutes les données de la sauvegarde Android', () => {
    const config = buildWith('1.0.0');
    expect(config.android?.allowBackup).toBe(false);
    expect(config.plugins).toContain('expo-local-authentication');
  });
});

describe('convention de version publiée', () => {
  it('compose la version à partir de la ligne produit et du versionCode', () => {
    expect(resolveAppVersion('1.0.0', 42)).toBe('1.0.42');
    expect(resolveAppVersion('2.13.0', 7)).toBe('2.13.7');
  });

  it('aligne la version Expo et le versionCode Android sur la même valeur', () => {
    process.env.ANDROID_VERSION_CODE = '128';
    try {
      const config = buildWith('1.0.0');
      expect(config.version).toBe('1.0.128');
      expect(config.android?.versionCode).toBe(128);
    } finally {
      delete process.env.ANDROID_VERSION_CODE;
    }
  });

  it('déclare dans app.json une ligne produit dont le patch reste à zéro', () => {
    // Le patch est toujours le versionCode : le dupliquer à la main créerait
    // deux sources de vérité divergentes.
    expect(appJson.expo.version).toMatch(/^\d+\.\d+\.0$/);
    expect(appJson.expo.android).not.toHaveProperty('versionCode');
  });

  it.each(['1.0', '1.0.3', 'v1.0.0', '1.0.0-beta', ''])(
    'refuse la ligne produit invalide %p',
    (version) => {
      expect(() => resolveAppVersion(version, 1)).toThrow('MAJEUR.MINEUR.0');
    },
  );

  it('refuse un versionCode incompatible avec une version publiée', () => {
    expect(() => resolveAppVersion('1.0.0', 0)).toThrow('versionCode');
    expect(() => resolveAppVersion('1.0.0', 1.5)).toThrow('versionCode');
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
