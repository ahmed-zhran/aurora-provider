import { checkBifrostHealth } from '../lib/aura-engine.js';

/**
 * Health check endpoint.
 * GET /api/health — returns server status + Bifrost connectivity
 */
export function createHealthRoute(auraService) {
  return {
    async check(c) {
      const bifrostOk = await checkBifrostHealth();
      return c.json({
        status: 'ok',
        version: '2.0.0',
        auras: auraService.names(),
        bifrost: bifrostOk ? 'connected' : 'unreachable',
        bifrostEndpoint: 'http://localhost:10550',
      });
    },
  };
}
