/**
 * Aura Engine — core fallback logic.
 *
 * Given an aura name, iterates its model fallback list and calls each via
 * the Bifrost HTTP endpoint until one succeeds.
 */

const BIFROST_URL = 'http://localhost:10550/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Execute an aura's fallback chain against Bifrost.
 *
 * @param {string} auraName
 * @param {object} body       - OpenAI-compatible chat request body
 * @param {object} auras      - Aura definitions { auraName: { fallbacks: [...] } }
 * @returns {Promise<{response: Response, provider: string, model: string}>}
 * @throws {Error} If all fallbacks are exhausted
 */
export async function executeAura(auraName, body, auras) {
  const aura = auras[auraName];
  if (!aura) {
    throw new Error(`Unknown aura: "${auraName}"`);
  }

  const chain = aura.fallbacks || [];
  if (chain.length === 0) {
    throw new Error(`Aura "${auraName}" has no fallbacks configured`);
  }

  const { model: _ignore, ...rest } = body;
  const basePayload = { ...rest, stream: body.stream ?? false };

  let lastError = null;

  for (const step of chain) {
    const { provider, model } = step;
    const label = `${provider}/${model}`;

    try {
      const response = await fetch(BIFROST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...basePayload, model }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const errMsg = `Bifrost HTTP ${response.status} for ${label}: ${text.slice(0, 200)}`;
        console.warn(`[aura-engine] ✗ ${errMsg}`);
        lastError = new Error(errMsg);
        continue;
      }

      console.log(`[aura-engine] ✓ ${auraName} → ${label}`);
      return { response, provider, model };
    } catch (err) {
      const errMsg = `Network error for ${label}: ${err.message}`;
      console.warn(`[aura-engine] ✗ ${errMsg}`);
      lastError = new Error(errMsg);
    }
  }

  const finalMsg = `All fallbacks exhausted for aura "${auraName}". Last error: ${lastError?.message || 'unknown'}`;
  console.error(`[aura-engine] ✗ ${finalMsg}`);
  throw new Error(finalMsg);
}

/**
 * Test Bifrost connectivity.
 * @returns {Promise<boolean>}
 */
export async function checkBifrostHealth() {
  try {
    const res = await fetch(`${BIFROST_URL.replace('/chat/completions', '/models')}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
