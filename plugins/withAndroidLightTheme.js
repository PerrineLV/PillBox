const { withAndroidStyles } = require('expo/config-plugins');

const LIGHT_PARENT = 'Theme.AppCompat.Light.NoActionBar';

/**
 * Fixe le thème Android de PillBox en clair.
 *
 * `expo prebuild` déclare `AppTheme` avec le parent
 * `Theme.AppCompat.DayNight.NoActionBar`, qui suit le mode clair/sombre du
 * téléphone. Les écrans de PillBox n'en dépendent pas — ils sont dessinés par
 * React Native à partir d'une palette claire unique — mais les surfaces
 * natives en héritent : sur un téléphone en mode sombre, la boîte de dialogue
 * du sélecteur d'heure s'affichait sur fond sombre au milieu d'une
 * application crème.
 *
 * Le sélecteur de date n'avait pas ce défaut : son thème est déjà forcé en
 * clair par le plugin de `@react-native-community/datetimepicker`. Celui de
 * l'heure n'est qu'un style de widget (`android:timePickerStyle`) posé sur
 * `AppTheme` : sa boîte de dialogue reprend donc le thème de l'application.
 *
 * Déclarer le thème clair décrit ici un fait plutôt qu'un choix nouveau :
 * PillBox n'a jamais eu d'interface sombre.
 *
 * Comme tout plugin de configuration, l'effet n'existe qu'à partir d'une
 * construction native : Expo Go embarque son propre thème et l'ignore.
 */
module.exports = function withAndroidLightTheme(config) {
  return withAndroidStyles(config, (modConfig) => {
    modConfig.modResults = forceLightAppTheme(modConfig.modResults);
    return modConfig;
  });
};

function forceLightAppTheme(styles) {
  const appTheme = (styles.resources.style ?? []).find(
    (style) => style.$.name === 'AppTheme',
  );
  if (appTheme === undefined) {
    throw new Error(
      'AppTheme est introuvable dans styles.xml : le thème clair ne peut pas être appliqué.',
    );
  }
  appTheme.$.parent = LIGHT_PARENT;
  return styles;
}

module.exports.LIGHT_PARENT = LIGHT_PARENT;
module.exports.forceLightAppTheme = forceLightAppTheme;
