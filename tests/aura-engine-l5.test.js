/**
 * L5 — Aura Engine Unit Tests (filling coverage gap)
 *
 * Tests executeAura fallback chain logic with mocked fetch.
 * Covers: single success, fallback chain iteration, all exhausted, empty chain, network errors.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

// Mock fetch globally before importing the engine
const originalFetch = globalThis.fetch;
let mockFetch;

beforeEach(() => {
  mockFetch = mock();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Import the engine AFTER setting up the mock
const engine = await import('../src/lib/aura-engine.js');

describe('L5 — Aura Engine: executeAura Fallback Logic', () => {
  it('succeeds on first fallback in chain', async () => {
    const mockResponse = new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
    mockFetch.mockResolvedValue(mockResponse);

    const result = await engine.executeAura('test-aura', {
      model: 'aurora-provider/test-aura',
      messages: [{ role: 'user', content: 'hi' }],
    }, {
      'test-aura': {
        fallbacks: [{ provider: 'bifrost', model: 'test/model-a' }],
      },
    });

    expect(result.response).toBe(mockResponse);
    expect(result.provider).toBe('bifrost');
    expect(result.model).toBe('test/model-a');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to second model when first fails with HTTP error', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response('Rate limited', { status: 429 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'fallback ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    const result = await engine.executeAura('test-aura', {
      messages: [{ role: 'user', content: 'hi' }],
    }, {
      'test-aura': {
        fallbacks: [
          { provider: 'bifrost', model: 'test/primary' },
          { provider: 'bifrost', model: 'test/fallback' },
        ],
      },
    });

    expect(result.model).toBe('test/fallback');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify first call used primary, second used fallback
    const calls = mockFetch.mock.calls;
    const firstBody = JSON.parse(calls[0][1].body);
    const secondBody = JSON.parse(calls[1][1].body);
    expect(firstBody.model).toBe('test/primary');
    expect(secondBody.model).toBe('test/fallback');
  });

  it('throws exhausted error when all fallbacks fail', async () => {
    mockFetch.mockResolvedValue(new Response('Error', { status: 500 }));

    await expect(engine.executeAura('test-aura', {
      messages: [{ role: 'user', content: 'hi' }],
    }, {
      'test-aura': {
        fallbacks: [
          { provider: 'bifrost', model: 'm1' },
          { provider: 'bifrost', model: 'm2' },
        ],
      },
    })).rejects.toThrow(/all fallbacks exhausted|ALL_FALLBACKS_EXHAUSTED/i);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws error for unknown aura', async () => {
    await expect(engine.executeAura('unknown-aura', {
      messages: [],
    }, {
      'test-aura': { fallbacks: [] },
    })).rejects.toThrow(/unknown aura/i);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws error when aura has empty fallbacks', async () => {
    await expect(engine.executeAura('empty-aura', {
      messages: [{ role: 'user', content: 'hi' }],
    }, {
      'empty-aura': { fallbacks: [] },
    })).rejects.toThrow(/no fallbacks/i);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles network errors and continues to next fallback', async () => {
    let callCount = 0;
    mockFetch.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new TypeError('fetch failed (network error)'));
      }
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    const result = await engine.executeAura('test-aura', {
      messages: [{ role: 'user', content: 'hi' }],
    }, {
      'test-aura': {
        fallbacks: [
          { provider: 'bifrost', model: 'm1' },
          { provider: 'bifrost', model: 'm2' },
        ],
      },
    });

    expect(result.model).toBe('m2');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('uses no-stream payload when stream is false', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await engine.executeAura('test-aura', {
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    }, {
      'test-aura': {
        fallbacks: [{ provider: 'bifrost', model: 'm1' }],
      },
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.stream).toBe(false);
  });

  it('uses stream payload when stream is true', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    await engine.executeAura('test-aura', {
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    }, {
      'test-aura': {
        fallbacks: [{ provider: 'bifrost', model: 'm1' }],
      },
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.stream).toBe(true);
  });

  it('preserves the Bifrost request URL', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await engine.executeAura('test-aura', {
      messages: [{ role: 'user', content: 'hi' }],
    }, {
      'test-aura': {
        fallbacks: [{ provider: 'bifrost', model: 'm1' }],
      },
    });

    const url = mockFetch.mock.calls[0][0];
    expect(url).toMatch(/localhost:10550/);
    expect(url).toMatch(/\/v1\/chat\/completions$/);
  });

  it('passes model from step into the Bifrost request body', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await engine.executeAura('test-aura', {
      model: 'aurora-provider/test-aura',
      messages: [{ role: 'user', content: 'hi' }],
    }, {
      'test-aura': {
        fallbacks: [{ provider: 'bifrost', model: 'step-model-name' }],
      },
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    // The model in the body should be the step's model, not the aura name
    expect(sentBody.model).toBe('step-model-name');
  });

  it('returns last error message in thrown exception', async () => {
    mockFetch.mockResolvedValue(new Response('Server Error', { status: 503 }));

    try {
      await engine.executeAura('test-aura', {
        messages: [{ role: 'user', content: 'hi' }],
      }, {
        'test-aura': {
          fallbacks: [{ provider: 'bifrost', model: 'm1' }],
        },
      });
    } catch (err) {
      expect(err.message).toMatch(/bifrost http 503/i);
    }
  });
});

describe('L5 — Aura Engine: checkBifrostHealth', () => {
  it('returns true when Bifrost models endpoint responds ok', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
    const result = await engine.checkBifrostHealth();
    expect(result).toBe(true);

    const url = mockFetch.mock.calls[0][0];
    expect(url).toMatch(/\/v1\/models$/);
  });

  it('returns false when Bifrost responds with error', async () => {
    mockFetch.mockResolvedValue(new Response('Not Found', { status: 404 }));
    const result = await engine.checkBifrostHealth();
    expect(result).toBe(false);
  });

  it('returns false when fetch throws (Bifrost unreachable)', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'));
    const result = await engine.checkBifrostHealth();
    expect(result).toBe(false);
  });
});
