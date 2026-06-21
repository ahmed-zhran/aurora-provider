import { stream } from 'hono/streaming';
import { executeAura } from '../lib/aura-engine.js';

/**
 * POST /v1/chat/completions
 *
 * OpenAI-compatible endpoint. The `model` field is used to resolve an aura name.
 * Falls back through the aura's fallback chain via Bifrost.
 */
export function createChatRoute(auraService, logService) {
  return async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, 400);
    }

    const { model, stream: isStream, ...rest } = body;
    if (!model) {
      return c.json({ error: { message: 'model is required', type: 'invalid_request_error' } }, 400);
    }

    // Resolve aura from model name
    // Supports both "aura-name" and "aurora-provider/aura-name"
    const auraName = model.includes('/') ? model.split('/').pop() : model;
    const auras = auraService.list();

    if (!auras[auraName]) {
      const available = Object.keys(auras).map(a => `aurora-provider/${a}`).join(', ');
      const errorMsg = `Unknown model/aura: "${model}". Available: ${available}`;
      logService.record({ model, status: 'Error', error: errorMsg });
      return c.json({
        error: { message: errorMsg, type: 'invalid_request_error' },
      }, 400);
    }

    const start = Date.now();
    let auraResult;

    try {
      auraResult = await executeAura(auraName, body, auras);
    } catch (err) {
      const latency = Date.now() - start;
      logService.record({ aura: auraName, model, status: 'Error', latencyMs: latency, error: err.message });
      return c.json({
        error: { message: `Aurora-Provider: ${err.message}`, type: 'service_unavailable' },
      }, 503);
    }

    const { response, provider, model: usedModel } = auraResult;
    const ct = response.headers.get('content-type') || 'text/plain';

    c.status(response.status);
    c.header('X-Aurora-Provider', `${provider}/${usedModel}`);

    const recordSuccess = async (completionTokens) => {
      const latency = Date.now() - start;
      logService.record({
        aura: auraName,
        model: usedModel,
        status: 'Success',
        latencyMs: latency,
      });
    };

    if (isStream || ct.includes('text/event-stream')) {
      c.header('Content-Type', ct);
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');

      return stream(c, async (streamInstance) => {
        for await (const chunk of response.body) {
          await streamInstance.write(chunk);
        }
        recordSuccess();
      });
    }

    // Non-streaming: pass through the upstream JSON
    try {
      const data = await response.json();
      recordSuccess();
      return c.json(data);
    } catch {
      // Fallback: return raw text
      const text = await response.text();
      recordSuccess();
      return c.text(text, response.status);
    }
  };
}
