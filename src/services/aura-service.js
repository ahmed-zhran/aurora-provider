import { loadConfig, saveJson } from '../lib/config.js';
import { join } from 'path';

const AURAS_FILE = 'auras.json';

export function createAuraService(vaultDir) {
  const path = join(vaultDir, AURAS_FILE);
  const { auras } = loadConfig(vaultDir, AURAS_FILE, { auras: {} });

  let aurasData = auras;

  function persist() {
    saveJson(path, { _comment: 'Aurora-Provider aura definitions.', _version: '2.0.0', auras: aurasData });
  }

  return {
    list() {
      return { ...aurasData };
    },

    get(name) {
      return aurasData[name] || null;
    },

    upsert(name, config) {
      aurasData[name] = config;
      persist();
      return aurasData[name];
    },

    remove(name) {
      if (!aurasData[name]) return false;
      delete aurasData[name];
      persist();
      return true;
    },

    replaceAll(newAuras) {
      aurasData = newAuras;
      persist();
    },

    /** Return aura names as array for model listing */
    names() {
      return Object.keys(aurasData);
    },
  };
}
