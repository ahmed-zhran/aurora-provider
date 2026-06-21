/**
 * Settings routes.
 * GET /api/settings — get current settings
 * PUT /api/settings — update settings
 */
export function createSettingsRoutes(settingsService) {
  return {
    get(c) {
      return c.json(settingsService.get());
    },

    async update(c) {
      try {
        const body = await c.req.json();
        const updated = settingsService.update(body);
        return c.json(updated);
      } catch (err) {
        return c.json({ error: err.message }, 500);
      }
    },
  };
}
