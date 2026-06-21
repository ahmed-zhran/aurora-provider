import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { loadJson, saveJson, loadConfig } from '../src/lib/config.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync } from 'fs';

const TEST_DIR = join(tmpdir(), 'aurora-config-test-' + Date.now());

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('config.js — Config Utilities (L5)', () => {
  it('saveJson writes valid JSON', () => {
    const path = join(TEST_DIR, 'test.json');
    saveJson(path, { hello: 'world', num: 42 });
    const loaded = loadJson(path);
    expect(loaded.hello).toBe('world');
    expect(loaded.num).toBe(42);
  });

  it('loadConfig returns default for missing file', () => {
    const config = loadConfig(TEST_DIR, 'missing.json', { defaultKey: true });
    expect(config.defaultKey).toBe(true);
  });

  it('loadConfig creates default file on disk', () => {
    const path = join(TEST_DIR, 'missing.json');
    expect(existsSync(path)).toBe(true);
  });

  it('loadConfig returns parsed content for existing file', () => {
    const config = loadConfig(TEST_DIR, 'test.json', {});
    expect(config.hello).toBe('world');
  });
});
