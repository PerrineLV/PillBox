const {
  LIGHT_PARENT,
  forceLightAppTheme,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
} = require('../withAndroidLightTheme.js');

type StyleGroup = {
  $: { name: string; parent: string };
  item?: { $: { name: string }; _: string }[];
};

function generatedStyles(): { resources: { style: StyleGroup[] } } {
  // Reproduit ce qu'écrit `expo prebuild` avant l'application du plugin.
  return {
    resources: {
      style: [
        {
          $: {
            name: 'AppTheme',
            parent: 'Theme.AppCompat.DayNight.NoActionBar',
          },
          item: [{ $: { name: 'colorPrimary' }, _: '@color/colorPrimary' }],
        },
        {
          $: { name: 'Theme.App.SplashScreen', parent: 'AppTheme' },
          item: [],
        },
      ],
    },
  };
}

/**
 * Ce thème n'est visible qu'à partir d'une construction native : Expo Go
 * embarque le sien et ignore les plugins de configuration. Ce test est donc le
 * seul contrôle automatique de ce réglage.
 */
describe('thème Android clair', () => {
  it('remplace le parent DayNight du thème de l’application', () => {
    const styles = generatedStyles();
    forceLightAppTheme(styles);
    expect(styles.resources.style[0].$.parent).toBe(LIGHT_PARENT);
    expect(LIGHT_PARENT).not.toContain('DayNight');
  });

  it('conserve les autres styles et le contenu du thème', () => {
    const styles = generatedStyles();
    forceLightAppTheme(styles);
    expect(styles.resources.style[0].item).toEqual([
      { $: { name: 'colorPrimary' }, _: '@color/colorPrimary' },
    ]);
    // Le thème de démarrage hérite d'AppTheme : il devient clair sans être
    // touché, et ne doit surtout pas être réécrit.
    expect(styles.resources.style[1].$.parent).toBe('AppTheme');
  });

  it('échoue bruyamment si le thème attendu a disparu', () => {
    expect(() => forceLightAppTheme({ resources: { style: [] } })).toThrow(
      /AppTheme/,
    );
  });
});
