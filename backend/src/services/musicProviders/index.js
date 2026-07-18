// backend/src/services/musicProviders/index.js
//
// Central registry of music providers. This is the ONLY file that
// needs to change to add a new provider (7digital, Free Music
// Archive, ccMixter, ...): implement MusicProviderInterface in a
// new file in this folder, then add one line below.

const LocalLibraryProvider = require("./LocalLibraryProvider");
const JamendoProvider = require("./JamendoProvider");

const PROVIDERS = {
  local: LocalLibraryProvider,
  jamendo: JamendoProvider
  // 7digital: require("./SevenDigitalProvider"),
  // fma:      require("./FreeMusicArchiveProvider"),
  // ccmixter: require("./CcMixterProvider"),
};

/**
 * @param {string} key - provider key, e.g. 'local' | 'jamendo'
 * @returns {import("./MusicProviderInterface")}
 */
function getProvider(key = "local") {
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`Unknown music provider "${key}". Available: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return provider;
}

function listProviderKeys() {
  return Object.keys(PROVIDERS);
}

module.exports = { getProvider, listProviderKeys };