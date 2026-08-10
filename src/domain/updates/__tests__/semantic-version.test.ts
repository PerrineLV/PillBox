import {
  compareSemanticVersions,
  formatSemanticVersion,
  isStrictlyNewerVersion,
  parseSemanticVersion,
} from '../semantic-version';

describe('lecture d’une version', () => {
  it('tolère le préfixe v des tags de release', () => {
    expect(parseSemanticVersion('v1.0.42')).toEqual({
      major: 1,
      minor: 0,
      patch: 42,
      prerelease: [],
    });
    expect(parseSemanticVersion('1.0.42')).toEqual(
      parseSemanticVersion('v1.0.42'),
    );
  });

  it('accepte une préversion et des métadonnées de build', () => {
    expect(parseSemanticVersion('v2.1.0-beta.3+build.7')).toEqual({
      major: 2,
      minor: 1,
      patch: 0,
      prerelease: ['beta', '3'],
    });
  });

  it.each([
    '',
    'latest',
    '1.0',
    '1.0.0.0',
    'android-9f2c1ab',
    'v1.0.x',
    null,
    undefined,
    42,
    { tag: '1.0.0' },
  ])('refuse la version illisible %p sans deviner', (value) => {
    expect(parseSemanticVersion(value)).toBeNull();
  });
});

describe('comparaison sémantique et non lexicographique', () => {
  it('classe 1.10.0 après 1.9.0', () => {
    expect(isStrictlyNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isStrictlyNewerVersion('1.9.0', '1.10.0')).toBe(false);
  });

  it('classe correctement les numéros de build à deux chiffres', () => {
    // Une comparaison de chaînes placerait « 1.0.9 » après « 1.0.10 ».
    expect(isStrictlyNewerVersion('1.0.10', '1.0.9')).toBe(true);
    expect(isStrictlyNewerVersion('1.0.100', '1.0.99')).toBe(true);
  });

  it('compare majeur puis mineur puis patch', () => {
    expect(isStrictlyNewerVersion('2.0.0', '1.99.99')).toBe(true);
    expect(isStrictlyNewerVersion('1.2.0', '1.1.99')).toBe(true);
  });

  it('considère une préversion antérieure à la version stable', () => {
    expect(isStrictlyNewerVersion('1.1.0', '1.1.0-beta.1')).toBe(true);
    expect(isStrictlyNewerVersion('1.1.0-beta.1', '1.1.0')).toBe(false);
    expect(isStrictlyNewerVersion('1.1.0-beta.2', '1.1.0-beta.1')).toBe(true);
    expect(isStrictlyNewerVersion('1.1.0-beta.11', '1.1.0-beta.2')).toBe(true);
    expect(isStrictlyNewerVersion('1.1.0-rc', '1.1.0-beta')).toBe(true);
  });

  it('n’alerte jamais à partir d’une version illisible', () => {
    expect(isStrictlyNewerVersion('latest', '1.0.0')).toBe(false);
    expect(isStrictlyNewerVersion('1.0.1', 'inconnue')).toBe(false);
  });

  it('retourne zéro pour deux versions équivalentes', () => {
    const left = parseSemanticVersion('v1.0.42');
    const right = parseSemanticVersion('1.0.42');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(compareSemanticVersions(left!, right!)).toBe(0);
  });
});

describe('normalisation affichée', () => {
  it('retire le préfixe v et conserve la préversion', () => {
    expect(formatSemanticVersion(parseSemanticVersion('v1.0.42')!)).toBe(
      '1.0.42',
    );
    expect(formatSemanticVersion(parseSemanticVersion('v2.0.0-rc.1')!)).toBe(
      '2.0.0-rc.1',
    );
  });
});
