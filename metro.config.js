const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// inlineRequires : les modules ne sont require()-és qu'à leur premier usage réel
// au lieu de tous au démarrage → démarrage JS plus rapide (gain surtout sur mobile).
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
