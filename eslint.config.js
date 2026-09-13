const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    rules: {
      // SDK 57 active ces règles liées au React Compiler. PillBox ne compile
      // pas encore ses composants avec celui-ci : ses effets chargent la base
      // locale de façon asynchrone et ses refs portent des identités natives
      // stables (file de tâches, Animated.Value), deux usages valides ici.
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
