import { loadConfig, saveJson } from '../lib/config.js';
import { join } from 'path';

const SETTINGS_FILE = 'settings.json';

export function createSettingsService(vaultDir) {
  const path = join(vaultDir, SETTINGS_FILE);
  let settings = loadConfig(vaultDir, SETTINGS_FILE, {
    _comment: 'Aurora-Provider settings.',
    latencyThreshold: 100,
    enableProxy: false,
  });

  function persist() {
    saveJson(path, settings);
  }

  return {
    get() {
      const { _comment, ...clean } = settings;
      return clean;
    },

    update(updates) {
      // Only allow known keys
      const allowed = ['latencyThreshold', 'enableProxy'];
      for (const key of Object.keys(updates)) {
        if (allowed.includes(key)) {
          settings[key] = updates[key];
        }
      }
      persist();
      return this.get();
    },
  };
}
