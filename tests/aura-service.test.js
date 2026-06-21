import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { createAuraService } from '../src/services/aura-service.js';

const TEST_DIR = join(tmpdir(), 'aurora-aura-test-' + Date.now());
let service;

beforeAll(() => {
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
  service = createAuraService(TEST_DIR);
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('aura-service.js — Aura Service (L5)', () => {
  it('list returns empty object initially', () => {
    const auras = service.list();
    expect(typeof auras).toBe('object');
  });

  it('upsert creates a new aura', () => {
    const aura = service.upsert('test-aura', { fallbacks: [{ provider: 'bifrost', model: 'm1' }] });
    expect(aura.fallbacks.length).toBe(1);
  });

  it('list returns created aura', () => {
    const auras = service.list();
    expect(auras['test-aura']).toBeDefined();
    expect(auras['test-aura'].fallbacks.length).toBe(1);
  });

  it('get returns specific aura', () => {
    const aura = service.get('test-aura');
    expect(aura).not.toBeNull();
    expect(aura.fallbacks[0].model).toBe('m1');
  });

  it('get returns null for unknown aura', () => {
    expect(service.get('nonexistent')).toBeNull();
  });

  it('upsert updates existing aura', () => {
    service.upsert('test-aura', { fallbacks: [{ provider: 'bifrost', model: 'm2' }, { provider: 'bifrost', model: 'm3' }] });
    const aura = service.get('test-aura');
    expect(aura.fallbacks.length).toBe(2);
  });

  it('remove deletes an aura', () => {
    service.upsert('to-delete', { fallbacks: [] });
    expect(service.remove('to-delete')).toBe(true);
    expect(service.get('to-delete')).toBeNull();
  });

  it('remove returns false for unknown aura', () => {
    expect(service.remove('nonexistent')).toBe(false);
  });

  it('names returns all aura names', () => {
    const names = service.names();
    expect(names).toContain('test-aura');
  });

  it('replaceAll replaces all auras', () => {
    service.replaceAll({ newAura: { fallbacks: [] } });
    expect(service.names()).toEqual(['newAura']);
    expect(service.get('test-aura')).toBeNull();
  });
});
