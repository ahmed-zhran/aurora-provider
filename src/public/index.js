// ─── Theme System ────────────────────────────────────────────────────────────
const THEMES = [
  { id: 'deep-space', label: 'Deep Space', swatch: 'linear-gradient(135deg, #6366f1, #10b981)' },
  { id: 'light',      label: 'Light Mode', swatch: 'linear-gradient(135deg, #4f46e5, #f0f2f8)' },
  { id: 'cyberpunk',  label: 'Cyberpunk',  swatch: 'linear-gradient(135deg, #00ffc8, #ff0078)' },
  { id: 'aurora',     label: 'Aurora',     swatch: 'linear-gradient(135deg, #a855f7, #f472b6)' },
  { id: 'ocean',      label: 'Ocean',      swatch: 'linear-gradient(135deg, #06b6d4, #10b981)' },
];

function initTheme() {
  const saved = localStorage.getItem('aurora-theme') || 'deep-space';
  applyTheme(saved, false);

  const btn = document.getElementById('theme-picker-btn');
  const dropdown = document.getElementById('theme-picker-dropdown');

  function positionDropdown() {
    const rect = btn.getBoundingClientRect();
    dropdown.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
    dropdown.style.left = (rect.right + window.scrollX - dropdown.offsetWidth) + 'px';
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open')) positionDropdown();
  });

  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('theme-picker-wrapper');
    if (!wrapper.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      applyTheme(opt.getAttribute('data-theme'), true);
      dropdown.classList.remove('open');
    });
  });

  window.addEventListener('resize', () => {
    if (dropdown.classList.contains('open')) positionDropdown();
  });
}

function applyTheme(themeId, save = true) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  document.documentElement.setAttribute('data-theme', themeId);
  const swatchEl = document.getElementById('theme-current-swatch');
  const labelEl = document.getElementById('theme-current-label');
  if (swatchEl) swatchEl.style.background = theme.swatch;
  if (labelEl) labelEl.textContent = theme.label;
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.getAttribute('data-theme') === themeId);
  });
  if (save) localStorage.setItem('aurora-theme', themeId);
}

// ─── State ───────────────────────────────────────────────────────────────────
let auras = {};
let logsPage = 1;
const LOGS_LIMIT = 15;
let selectedAura = null;

// ─── Tab Navigation ──────────────────────────────────────────────────────────
function initTabs() {
  const savedTab = localStorage.getItem('aurora-tab');
  let activeTab = savedTab && document.getElementById(savedTab) ? savedTab : 'tab-dashboard';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
      activeTab = tabId;
      localStorage.setItem('aurora-tab', tabId);

      if (tabId === 'tab-dashboard') loadLogs();
      if (tabId === 'tab-auras') loadAuras();
    });
  });

  // Activate saved tab
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${activeTab}"]`);
  if (targetBtn) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    targetBtn.classList.add('active');
    document.getElementById(activeTab).classList.add('active');
  }
}

// ─── API Helpers ─────────────────────────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Dashboard: Logs ─────────────────────────────────────────────────────────
async function loadLogs() {
  try {
    const params = new URLSearchParams({ page: logsPage, limit: LOGS_LIMIT });
    const startDate = document.getElementById('filter-start-date').value;
    const endDate = document.getElementById('filter-end-date').value;
    const aura = document.getElementById('filter-aura').value;
    const status = document.getElementById('filter-status').value;
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (aura) params.set('aura', aura);
    if (status) params.set('status', status);

    const data = await api(`/api/logs?${params}`);

    // Metrics
    document.getElementById('stats-total-requests').textContent = data.totalCount || 0;
    const successRate = data.totalCount > 0 ? Math.round((data.successCount / data.totalCount) * 100) : 0;
    document.getElementById('stats-success-rate').textContent = successRate + '%';
    document.getElementById('stats-avg-latency').textContent = (data.avgLatency || 0) + 'ms';

    // Table
    const tbody = document.getElementById('logs-tbody');
    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted);">No logs found.</td></tr>';
    } else {
      tbody.innerHTML = data.logs.map(log => `
        <tr>
          <td>${log.timestamp || '-'}</td>
          <td>${log.aura || '-'}</td>
          <td>${log.model || '-'}</td>
          <td><span class="status-badge ${log.status === 'Success' ? 'status-ok' : 'status-err'}">${log.status}</span></td>
          <td style="text-align:right;">${log.latency_ms || 0}ms</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${log.error || '-'}</td>
        </tr>
      `).join('');
    }

    // Pagination
    const totalPages = Math.ceil((data.totalCount || 0) / LOGS_LIMIT) || 1;
    document.getElementById('pagination-info').textContent = `Page ${logsPage} of ${totalPages}`;
    document.getElementById('prev-page-btn').disabled = logsPage <= 1;
    document.getElementById('next-page-btn').disabled = logsPage >= totalPages;

    // Populate aura filter dropdown
    if (data.stats && data.stats.auras) {
      const select = document.getElementById('filter-aura');
      const currentVal = select.value;
      select.innerHTML = '<option value="">All Auras</option>' +
        data.stats.auras.map(a => `<option value="${a.aura}" ${a.aura === currentVal ? 'selected' : ''}>${a.aura}</option>`).join('');
    }
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

function clearLogs() {
  if (!confirm('Clear all usage logs?')) return;
  api('/api/logs/clear', { method: 'POST' })
    .then(() => { logsPage = 1; loadLogs(); })
    .catch(err => alert('Failed to clear logs: ' + err.message));
}

// ─── Aura Hub ────────────────────────────────────────────────────────────────
async function loadAuras() {
  try {
    const data = await api('/api/auras');
    auras = data.auras || {};
    renderAuraList();
    if (selectedAura && auras[selectedAura]) {
      showAuraDetail(selectedAura);
    } else {
      hideAuraDetail();
      selectedAura = null;
    }
  } catch (err) {
    console.error('Failed to load auras:', err);
    document.getElementById('auras-list').innerHTML =
      '<p class="text-muted" style="padding:1rem;text-align:center;color:var(--color-danger);">Failed to load auras: ' + err.message + '</p>';
  }
}

function renderAuraList() {
  const container = document.getElementById('auras-list');
  const names = Object.keys(auras);
  if (names.length === 0) {
    container.innerHTML = '<p class="text-muted" style="padding:1rem;text-align:center;">No auras configured. Create one above.</p>';
    return;
  }
  container.innerHTML = names.map(name => `
    <div class="aura-item ${selectedAura === name ? 'selected' : ''}" data-aura="${name}">
      <span class="aura-name">${name}</span>
      <span class="aura-item-count">${(auras[name].fallbacks || []).length} steps</span>
    </div>
  `).join('');

  container.querySelectorAll('.aura-item').forEach(el => {
    el.addEventListener('click', () => {
      selectedAura = el.getAttribute('data-aura');
      renderAuraList();
      showAuraDetail(selectedAura);
    });
  });
}

async function createAura() {
  const input = document.getElementById('new-aura-name');
  const name = input.value.trim();
  if (!name) return alert('Enter an aura name.');
  if (auras[name]) return alert('Aura "' + name + '" already exists.');

  try {
    await api('/api/auras', {
      method: 'POST',
      body: JSON.stringify({ name, fallbacks: [] }),
    });
    input.value = '';
    selectedAura = name;
    await loadAuras();
  } catch (err) {
    alert('Failed to create aura: ' + err.message);
  }
}

async function deleteAura() {
  if (!selectedAura) return;
  if (!confirm('Delete aura "' + selectedAura + '"?')) return;

  try {
    await api('/api/auras/' + encodeURIComponent(selectedAura), { method: 'DELETE' });
    selectedAura = null;
    hideAuraDetail();
    await loadAuras();
  } catch (err) {
    alert('Failed to delete aura: ' + err.message);
  }
}

function showAuraDetail(name) {
  document.getElementById('aura-detail-panel').style.display = 'block';
  document.getElementById('aura-detail-empty').style.display = 'none';
  document.getElementById('aura-detail-name').textContent = name;

  const chain = auras[name]?.fallbacks || [];
  const container = document.getElementById('fallback-chain-list');

  if (chain.length === 0) {
    container.innerHTML = '<p class="text-muted" style="padding:0.5rem 0;">No fallbacks configured. Add one below.</p>';
  } else {
    container.innerHTML = chain.map((step, i) => `
      <div class="fallback-step-item">
        <span class="step-priority-number">${i + 1}</span>
        <div class="step-details">
          <span class="step-provider">${step.provider || 'bifrost'}</span>
          <span class="step-model">${step.model || '?'}</span>
        </div>
        <div class="step-actions">
          <button class="btn btn-danger btn-sm remove-step-btn" data-index="${i}" style="padding:0.2rem 0.5rem;">×</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.remove-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index'));
        chain.splice(idx, 1);
        showAuraDetail(name);
      });
    });
  }
}

function hideAuraDetail() {
  document.getElementById('aura-detail-panel').style.display = 'none';
  document.getElementById('aura-detail-empty').style.display = 'block';
}

function addFallbackStep() {
  if (!selectedAura) return;
  const input = document.getElementById('step-model-input');
  const model = input.value.trim();
  if (!model) return alert('Enter a model ID.');

  if (!auras[selectedAura].fallbacks) auras[selectedAura].fallbacks = [];
  auras[selectedAura].fallbacks.push({ provider: 'bifrost', model });
  input.value = '';
  showAuraDetail(selectedAura);
}

async function saveAuras() {
  if (!selectedAura) return;
  try {
    await api('/api/auras', {
      method: 'POST',
      body: JSON.stringify({
        name: selectedAura,
        fallbacks: auras[selectedAura].fallbacks,
      }),
    });
    await loadAuras();
    alert('Aura saved successfully.');
  } catch (err) {
    alert('Failed to save aura: ' + err.message);
  }
}

// ─── Health Check ────────────────────────────────────────────────────────────
async function checkHealth() {
  try {
    const data = await api('/api/health');
    document.getElementById('status-health').textContent =
      'Status: ok | Auras: ' + (data.auras || []).length + ' | Bifrost: ' + (data.bifrost || 'unknown');
  } catch (err) {
    document.getElementById('status-health').textContent = 'Status: error (' + err.message + ')';
  }
}

// ─── Global: Remove Fallback Step ────────────────────────────────────────
window.removeFallbackStep = function(idx) {
  if (!selectedAura || !auras[selectedAura]) return;
  const chain = auras[selectedAura].fallbacks;
  if (idx >= 0 && idx < chain.length) {
    chain.splice(idx, 1);
    showAuraDetail(selectedAura);
  }
};

// ─── Init ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initTabs();

  // Dashboard events
  document.getElementById('apply-filters-btn').addEventListener('click', () => {
    logsPage = 1;
    loadLogs();
  });
  document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (logsPage > 1) { logsPage--; loadLogs(); }
  });
  document.getElementById('next-page-btn').addEventListener('click', () => {
    logsPage++; loadLogs();
  });
  document.getElementById('clear-logs-btn').addEventListener('click', clearLogs);

  // Aura Hub events
  document.getElementById('create-aura-btn').addEventListener('click', createAura);
  document.getElementById('delete-aura-btn').addEventListener('click', deleteAura);
  document.getElementById('add-step-btn').addEventListener('click', addFallbackStep);
  document.getElementById('save-auras-btn').addEventListener('click', saveAuras);

  // Initial loads
  checkHealth();
  setInterval(checkHealth, 30000);

  if (document.getElementById('tab-dashboard').classList.contains('active')) {
    loadLogs();
  }
  if (document.getElementById('tab-auras').classList.contains('active')) {
    loadAuras();
  }
});
