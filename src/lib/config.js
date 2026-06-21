import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Generic JSON config loader / saver for vault directory.
 */
export function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function saveJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function loadConfig(vaultDir, filename, defaultValue = {}) {
  const path = join(vaultDir, filename);
  if (!existsSync(path)) {
    saveJson(path, defaultValue);
    return defaultValue;
  }
  try {
    return loadJson(path);
  } catch {
    console.warn(`[config] Corrupt ${filename}, resetting to default`);
    saveJson(path, defaultValue);
    return defaultValue;
  }
}
