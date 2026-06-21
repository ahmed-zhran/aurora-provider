/**
 * Usage log routes.
 * GET  /api/logs       — query logs with filters + pagination
 * POST /api/logs/clear — clear all logs
 */
export function createLogRoutes(logService) {
  return {
    query(c) {
      try {
        const filters = {
          startDate: c.req.query('startDate'),
          endDate: c.req.query('endDate'),
          aura: c.req.query('aura'),
          status: c.req.query('status'),
          page: parseInt(c.req.query('page') || '1', 10),
          limit: parseInt(c.req.query('limit') || '50', 10),
        };

        const result = logService.query(filters);
        const stats = logService.stats(filters);

        return c.json({ success: true, ...result, stats });
      } catch (err) {
        return c.json({ error: err.message }, 500);
      }
    },

    clear(c) {
      try {
        logService.clear();
        return c.json({ success: true, message: 'Usage logs cleared.' });
      } catch (err) {
        return c.json({ error: err.message }, 500);
      }
    },
  };
}
