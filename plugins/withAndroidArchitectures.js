const { withGradleProperties } = require('expo/config-plugins');

const ARCHITECTURES = 'arm64-v8a,armeabi-v7a';

// Appliqué au projet généré par le prébuild CI. L’APK distribué cible les
// téléphones ARM ; les bibliothèques x86/x86_64 ne sont pas embarquées.
module.exports = function withAndroidArchitectures(config) {
  return withGradleProperties(config, (modConfig) => {
    modConfig.modResults = setAndroidArchitectures(modConfig.modResults);
    return modConfig;
  });
};

function setAndroidArchitectures(properties) {
  return [
    ...properties.filter(
      (item) =>
        item.type !== 'property' || item.key !== 'reactNativeArchitectures',
    ),
    { type: 'property', key: 'reactNativeArchitectures', value: ARCHITECTURES },
  ];
}

module.exports.setAndroidArchitectures = setAndroidArchitectures;
