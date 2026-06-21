/**
 * Aura CRUD routes.
 * GET    /api/auras        — list all auras
 * POST   /api/auras        — create/update aura
 * DELETE /api/auras/:name  — delete an aura
 */
export function createAuraRoutes(auraService) {
  return {
    list(c) {
      return c.json({ auras: auraService.list() });
    },

    upsert(c) {
      const { name, ...config } = c.req.queries ? {} : {};
      // Allow JSON body or query params
      return c.json({ success: true, aura: null });
    },

    async createOrUpdate(c) {
      try {
        const body = await c.req.json();
        const { name, fallbacks } = body;
        if (!name) return c.json({ error: 'name is required' }, 400);
        if (!fallbacks || !Array.isArray(fallbacks)) {
          return c.json({ error: 'fallbacks array is required' }, 400);
        }
        const aura = auraService.upsert(name, { fallbacks });
        return c.json({ success: true, aura: { name, ...aura } });
      } catch (err) {
        return c.json({ error: err.message }, 500);
      }
    },

    remove(c) {
      const name = c.req.param('name');
      if (!name) return c.json({ error: 'name parameter required' }, 400);
      const removed = auraService.remove(name);
      if (!removed) return c.json({ error: `Aura "${name}" not found` }, 404);
      return c.json({ success: true });
    },
  };
}
