import type { AndroidConfig } from 'expo/config-plugins';

const {
  setAndroidArchitectures,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('../withAndroidArchitectures.js') as {
  setAndroidArchitectures(
    properties: AndroidConfig.Properties.PropertiesItem[],
  ): AndroidConfig.Properties.PropertiesItem[];
};

const armProperty = {
  type: 'property' as const,
  key: 'reactNativeArchitectures',
  value: 'arm64-v8a,armeabi-v7a',
};

describe('architectures Android distribuées', () => {
  it('remplace la liste universelle et préserve les autres propriétés et commentaires', () => {
    const untouched: AndroidConfig.Properties.PropertiesItem[] = [
      { type: 'comment', value: 'Architectures natives' },
      { type: 'empty' },
      { type: 'property', key: 'hermesEnabled', value: 'true' },
    ];
    const input = [
      ...untouched,
      { ...armProperty, value: 'armeabi-v7a,arm64-v8a,x86,x86_64' },
    ];
    expect(setAndroidArchitectures(input)).toEqual([...untouched, armProperty]);
    expect(input[3]).toEqual({
      ...armProperty,
      value: 'armeabi-v7a,arm64-v8a,x86,x86_64',
    });
  });

  it('ajoute la propriété lorsqu’elle manque', () => {
    expect(setAndroidArchitectures([])).toEqual([armProperty]);
  });

  it('élimine les doublons et reste idempotent', () => {
    const once = setAndroidArchitectures([
      armProperty,
      { ...armProperty, value: 'x86_64' },
    ]);
    expect(once).toEqual([armProperty]);
    expect(setAndroidArchitectures(once)).toEqual(once);
  });
});
