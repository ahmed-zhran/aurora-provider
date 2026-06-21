import { describe, it, expect } from 'bun:test';
import { checkBifrostHealth } from '../src/lib/aura-engine.js';

describe('aura-engine.js — Aura Engine (L5)', () => {
  it('checkBifrostHealth returns boolean', async () => {
    const result = await checkBifrostHealth();
    expect(typeof result).toBe('boolean');
  });

  it('exports executeAura function', () => {
    const engine = require('../src/lib/aura-engine.js');
    expect(typeof engine.executeAura).toBe('function');
  });
});
