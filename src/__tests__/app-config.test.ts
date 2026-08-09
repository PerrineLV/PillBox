import { resolveAndroidVersionCode } from '../../app.config';

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
