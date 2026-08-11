module.exports = function (api) {
  const isProduction = api.env('production');
  api.cache.using(() => isProduction);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Retire console.log/info/debug du bundle release (garde error/warn pour le diagnostic).
      // react-native-reanimated/plugin doit rester le DERNIER plugin de la liste.
      ...(isProduction ? [['transform-remove-console', { exclude: ['error', 'warn'] }]] : []),
      'react-native-reanimated/plugin',
    ],
  };
};
