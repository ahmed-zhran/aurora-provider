import { insertLog, queryLogs, getLogStats, clearLogs } from '../lib/db.js';

export function createLogService(db) {
  return {
    record({ aura, model, status, latencyMs, error } = {}) {
      return insertLog(db, { aura, model, status, latencyMs, error });
    },

    query(filters = {}) {
      return queryLogs(db, filters);
    },

    stats(filters = {}) {
      return getLogStats(db, filters);
    },

    clear() {
      return clearLogs(db);
    },
  };
}
