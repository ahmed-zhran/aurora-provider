// Global State
let config = {
  providers: {},
  auras: {},
  keys: {},
  ips: []
};

let activeTab = 'tab-dashboard';
let selectedAuraName = null;
let selectedProviderName = null;
let healthTimer = null;
let uptimeTimer = null;
let startTime = Date.now();

// Visible providers in Keys & Health tab (accordions)
let visibleProvidersInKeysTab = [];

// Usage tab state
let logsPage = 1;
const logsLimit = 15;
let chartRequestsTime = null;
let chartProvidersPie = null;

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

  // Toggle dropdown
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    if (!isOpen) {
      dropdown.classList.add('open');
      positionDropdown();
    } else {
      dropdown.classList.remove('open');
    }
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('theme-picker-wrapper');
    if (!wrapper.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.remove('open');
    }
  });

  // Theme option clicks
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const themeId = opt.getAttribute('data-theme');
      applyTheme(themeId, true);
      dropdown.classList.remove('open');
    });
  });

  // Reposition on window resize
  window.addEventListener('resize', () => {
    if (dropdown.classList.contains('open')) {
      positionDropdown();
    }
  });
}

function applyTheme(themeId, save = true) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  
  // Apply data-theme to root element
  document.documentElement.setAttribute('data-theme', themeId);
  
  // Update picker button label and swatch
  const swatchEl = document.getElementById('theme-current-swatch');
  const labelEl = document.getElementById('theme-current-label');
  if (swatchEl) swatchEl.style.background = theme.swatch;
  if (labelEl) labelEl.textContent = theme.label;
  
  // Highlight active option in dropdown
  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.classList.toggle('active', opt.getAttribute('data-theme') === themeId);
  });
  
  if (save) localStorage.setItem('aurora-theme', themeId);
}

// ─── Initializer ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Ensure modal is closed on load
  const modal = document.getElementById('log-details-modal');
  if (modal) modal.style.display = 'none';

  // Init theme picker
  initTheme();

  // Restore persisted tab — use 'aurora-tab' key (resets stale 'activeTab' value)
  const persistedTab = localStorage.getItem('aurora-tab');
  if (persistedTab && document.getElementById(persistedTab)) {
    activeTab = persistedTab;
  } else {
    activeTab = 'tab-dashboard';
  }

  initTabs();
  loadConfig();
  
  // Dashboard event listeners
  document.getElementById('refresh-proxies-btn').addEventListener('click', triggerProxyRefresh);
  document.getElementById('api-test-form').addEventListener('submit', runApiTest);
  document.getElementById('clear-response-btn').addEventListener('click', () => {
    document.getElementById('json-response-output').textContent = 'Ready to test.';
  });


  // Auras event listeners
  document.getElementById('create-aura-btn').addEventListener('click', createAura);
  document.getElementById('rename-aura-btn').addEventListener('click', renameSelectedAura);
  document.getElementById('delete-aura-btn').addEventListener('click', deleteSelectedAura);
  document.getElementById('step-provider-select').addEventListener('change', updateStepModelsDropdown);
  document.getElementById('add-step-btn').addEventListener('click', addFallbackStep);
  document.getElementById('save-auras-btn').addEventListener('click', saveAurasConfig);

  // Keys event listeners
  document.getElementById('save-keys-btn').addEventListener('click', saveKeysConfig);

  // Proxy settings event listeners
  const slider = document.getElementById('proxy-latency-threshold-slider');
  const sliderVal = document.getElementById('proxy-latency-threshold-val');
  if (slider && sliderVal) {
    slider.addEventListener('input', () => {
      sliderVal.textContent = slider.value + 'ms';
    });
  }
  const saveProxySettingsBtn = document.getElementById('save-proxy-settings-btn');
  if (saveProxySettingsBtn) {
    saveProxySettingsBtn.addEventListener('click', saveProxySettings);
  }

  // Providers event listeners
  document.getElementById('create-provider-btn').addEventListener('click', createProvider);
  document.getElementById('delete-provider-btn').addEventListener('click', deleteSelectedProvider);
  document.getElementById('save-providers-btn').addEventListener('click', saveProvidersConfig);

  // Usage tab event listeners
  document.getElementById('apply-filters-btn').addEventListener('click', () => {
    logsPage = 1;
    loadUsageStats();
  });
  document.getElementById('prev-page-btn').addEventListener('click', () => {
    if (logsPage > 1) {
      logsPage--;
      loadUsageStats();
    }
  });
  document.getElementById('next-page-btn').addEventListener('click', () => {
    logsPage++;
    loadUsageStats();
  });
  document.getElementById('close-modal-btn').addEventListener('click', () => {
    document.getElementById('log-details-modal').style.display = 'none';
  });

  // Close modal on overlay click
  document.getElementById('log-details-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('log-details-modal')) {
      document.getElementById('log-details-modal').style.display = 'none';
    }
  });

  // Add Key Setup button
  const addKeyBtn = document.getElementById('add-key-provider-btn');
  if (addKeyBtn) {
    addKeyBtn.addEventListener('click', () => {
      const select = document.getElementById('add-key-provider-select');
      const providerId = select.value;
      if (!providerId) {
        alert('Please select a provider first.');
        return;
      }
      if (!visibleProvidersInKeysTab.includes(providerId)) {
        visibleProvidersInKeysTab.push(providerId);
        renderKeysTab();
        // Expand the newly added accordion body
        setTimeout(() => {
          const card = document.querySelector(`.keys-accordion-card[data-provider="${providerId}"]`);
          if (card) {
            const body = card.querySelector('.keys-accordion-body');
            const chevron = card.querySelector('.keys-acc-chevron');
            if (body && chevron) {
              body.style.display = 'block';
              card.classList.add('expanded');
              chevron.textContent = '▾';
            }
          }
        }, 50);
      }
    });
  }

  // Clear request logs button
  const clearRequestLogsBtn = document.getElementById('clear-request-logs-btn');
  if (clearRequestLogsBtn) {
    clearRequestLogsBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete the entire usage logs history? This action cannot be undone.')) {
        try {
          const res = await fetchJSON('/api/usage/clear', { method: 'POST' });
          if (res.success) {
            alert('Request logs history cleared successfully!');
            logsPage = 1;
            loadUsageStats();
          } else {
            alert('Failed to clear request logs: ' + (res.error || 'Unknown error'));
          }
        } catch (err) {
          alert('Failed to clear request logs: ' + err.message);
        }
      }
    });
  }

  // Clear proxy refresh history button
  const clearProxyHistoryBtn = document.getElementById('clear-proxy-history-btn');
  if (clearProxyHistoryBtn) {
    clearProxyHistoryBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to delete all proxy refresh operation history? This action cannot be undone.')) {
        try {
          const res = await fetchJSON('/api/proxies/refresh-history/clear', { method: 'POST' });
          if (res.success) {
            alert('Proxy refresh history cleared successfully!');
            loadProxyRefreshHistory();
          } else {
            alert('Failed to clear proxy refresh history: ' + (res.error || 'Unknown error'));
          }
        } catch (err) {
          alert('Failed to clear proxy refresh history: ' + err.message);
        }
      }
    });
  }

  // Refresh provider models button
  const refreshModelsBtn = document.getElementById('refresh-provider-models-btn');
  if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener('click', refreshProviderModels);
  }

  // Start status polling
  startStatusPolling();
  startProxyStatusPolling();
});

// ─── Tabs Navigation ─────────────────────────────────────────────────────────

function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // Activate initial tab
  tabButtons.forEach(btn => {
    const tabName = btn.getAttribute('data-tab');
    if (tabName === activeTab) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  tabPanes.forEach(pane => {
    const paneName = pane.getAttribute('id');
    if (paneName === activeTab) {
      pane.classList.add('active');
    } else {
      pane.classList.remove('active');
    }
  });

  // Trigger loading state for active tab
  triggerTabLoad(activeTab);

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(targetTab);
      pane.classList.add('active');
      
      activeTab = targetTab;
      localStorage.setItem('aurora-tab', activeTab);
      
      triggerTabLoad(activeTab);
    });
  });
}

function triggerTabLoad(tabName) {
  if (tabName === 'tab-dashboard') {
    loadUsageFilters();
    loadUsageStats();
  } else if (tabName === 'tab-tester') {
    updateAurasDropdown();
  } else if (tabName === 'tab-auras') {
    renderAurasTab();
  } else if (tabName === 'tab-keys') {
    renderKeysTab();
  } else if (tabName === 'tab-providers') {
    renderProvidersTab();
  } else if (tabName === 'tab-proxies') {
    renderProxiesTab();
  } else if (tabName === 'tab-supported-providers') {
    renderSupportedProvidersTab();
  }
}



// ─── API Requests ────────────────────────────────────────────────────────────

async function fetchJSON(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || `HTTP error ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error(`Fetch error on ${url}:`, err);
    alert(`Error: ${err.message}`);
    throw err;
  }
}

async function loadConfig() {
  try {
    config = await fetchJSON('/api/config');
    
    // Initialize visibleProvidersInKeysTab with providers that currently have configured API keys
    visibleProvidersInKeysTab = Object.keys(config.providers).filter(provId => hasApiKey(provId));

    renderUIPool();
    updateAurasDropdown();
    triggerTabLoad(activeTab);
  } catch (err) {
    console.error("Failed to load configs", err);
  }
}

// ─── Uptime & Health Polling ──────────────────────────────────────────────────


function formatUptime(seconds) {
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h < 24) return `${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h ${m}m`;
}

function formatDateTime(dateInput) {
  if (!dateInput) return '—';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return dateInput;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');

    return `${year}-${month}-${day} ${hoursStr}:${minutes}:${seconds} ${ampm}`;
  } catch (e) {
    return dateInput;
  }
}

function getCleanProxyHost(proxyUrl) {
  if (!proxyUrl || proxyUrl === '-') return '-';
  try {
    let urlToParse = proxyUrl;
    if (!urlToParse.includes('://')) {
      urlToParse = 'socks5://' + urlToParse;
    }
    const parsed = new URL(urlToParse);
    return parsed.hostname || proxyUrl;
  } catch (e) {
    try {
      let host = proxyUrl;
      if (host.includes('://')) {
        host = host.split('://')[1];
      }
      if (host.includes('@')) {
        host = host.split('@')[1];
      }
      if (host.includes(':')) {
        host = host.split(':')[0];
      }
      return host || proxyUrl;
    } catch (err) {
      return proxyUrl;
    }
  }
}

function startStatusPolling() {
  updateHealthStatus();
  healthTimer = setInterval(updateHealthStatus, 5000);
}

async function updateHealthStatus() {
  try {
    const res = await fetch('/status');
    if (!res.ok) throw new Error('Offline');
    const data = await res.json();

    // Update server info bar (Logs tab)
    const dot = document.getElementById('server-status-dot');
    const txt = document.getElementById('server-status-text');
    const uptimeEl = document.getElementById('server-uptime');
    const aurasEl = document.getElementById('server-auras-count');

    if (dot) { dot.className = 'status-indicator online'; }
    if (txt) { txt.textContent = 'Online'; txt.style.color = 'var(--color-success)'; }
    if (uptimeEl) { uptimeEl.textContent = formatUptime(data.uptime); }
    if (aurasEl) { aurasEl.textContent = Object.keys(config.auras).length + ' auras'; }

    renderHealthGrid(data.keyStates);
  } catch (err) {
    const dot = document.getElementById('server-status-dot');
    const txt = document.getElementById('server-status-text');
    const uptimeEl = document.getElementById('server-uptime');

    if (dot) { dot.className = 'status-indicator offline'; }
    if (txt) { txt.textContent = 'Offline / Crashed'; txt.style.color = 'var(--color-danger)'; }
    if (uptimeEl) { uptimeEl.textContent = '—'; }

    renderHealthGrid({});
  }
}

function renderHealthGrid(keyStates) {
  const container = document.getElementById('health-grid');
  container.innerHTML = '';

  const providers = Object.keys(config.providers);
  if (providers.length === 0) {
    container.innerHTML = '<div class="text-muted">No providers registered.</div>';
    return;
  }

  providers.forEach(provName => {
    const row = document.createElement('div');
    row.className = 'provider-health-row';

    const header = document.createElement('div');
    header.className = 'provider-health-header';

    const name = document.createElement('span');
    name.className = 'provider-name';
    name.textContent = config.providers[provName].name || provName;

    const keys = config.keys[provName] || [];
    const states = keyStates[provName] || [];

    const summary = document.createElement('span');
    summary.className = 'provider-keys-summary';
    
    const availableCount = states.filter(s => s.available).length;
    summary.textContent = keys.length > 0 
      ? `${availableCount}/${keys.length} available`
      : 'No keys configured';
    
    header.appendChild(name);
    header.appendChild(summary);
    row.appendChild(header);

    // Dots representing each key
    if (keys.length > 0) {
      const dotsContainer = document.createElement('div');
      dotsContainer.className = 'keys-dots';

      const timersContainer = document.createElement('div');
      timersContainer.className = 'cooldown-timers';

      keys.forEach((keyData, index) => {
        const dot = document.createElement('span');
        const state = states.find(s => s.keyIndex === index);
        
        dot.className = 'key-dot';
        
        // Show tooltip details
        const keyLabel = typeof keyData === 'object' && keyData !== null ? (keyData.name || `Key ${index}`) : `Key ${index}`;
        dot.title = keyLabel;

        if (!state) {
          dot.className += ' available';
        } else if (state.available) {
          dot.className += ' available';
        } else {
          dot.className += ' cooling';
          
          // Show cooldown time left
          const cooldownLeft = Math.ceil((state.state.cooldownUntil - Date.now()) / 1000);
          if (cooldownLeft > 0) {
            const timer = document.createElement('div');
            timer.textContent = `${keyLabel} cooling down: ${cooldownLeft}s left`;
            timersContainer.appendChild(timer);
          }
        }
        
        dotsContainer.appendChild(dot);
      });
      row.appendChild(dotsContainer);
      if (timersContainer.children.length > 0) {
        row.appendChild(timersContainer);
      }
    } else {
      const dot = document.createElement('span');
      dot.className = 'key-dot empty';
      row.appendChild(dot);
    }

    container.appendChild(row);
  });
}

function renderUIPool() {
  // No-op: logs tab removed
}

// ─── API Tester ──────────────────────────────────────────────────────────────

function updateAurasDropdown() {
  const select = document.getElementById('test-aura-select');
  if (!select) return;
  select.innerHTML = '';

  const auraNames = Object.keys(config.auras);
  if (auraNames.length === 0) {
    select.innerHTML = '<option value="" disabled selected>No auras configured</option>';
    select.disabled = true;
    document.getElementById('aura-warning').style.display = 'block';
    return;
  }

  select.disabled = false;
  document.getElementById('aura-warning').style.display = 'none';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Select an aura...';
  select.appendChild(placeholder);

  auraNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `aurora-provider/${name}`;
    select.appendChild(opt);
  });
}

async function runApiTest(e) {
  e.preventDefault();
  const aura = document.getElementById('test-aura-select').value;
  const prompt = document.getElementById('test-prompt').value;
  const stream = document.getElementById('test-stream').checked;
  const output = document.getElementById('json-response-output');
  const runBtn = document.getElementById('run-test-btn');

  if (!aura) {
    alert("Please select an aura to test.");
    return;
  }

  runBtn.disabled = true;
  runBtn.textContent = 'Executing...';
  output.textContent = 'Routing request and waiting for response...';

  try {
    const payload = {
      model: `aurora-provider/${aura}`,
      messages: [{ role: 'user', content: prompt }],
      stream
    };

    const startTime = Date.now();
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Source': 'Testing' // Identify request source
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP error ${res.status}`);
    }

    if (stream) {
      output.textContent = '';
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        output.textContent += text;
      }
    } else {
      const data = await res.json();
      output.textContent = JSON.stringify(data, null, 2);
    }
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = 'Run Test';
    loadUsageStats();
  }
}

// ─── TAB 2: Aura Hub ────────────────────────────────────────────────────

function renderAurasTab() {
  const container = document.getElementById('auras-selector-container');
  if (!container) return;
  container.innerHTML = '';

  const auraNames = Object.keys(config.auras);
  if (auraNames.length === 0) {
    container.innerHTML = '<div class="text-muted p-3">No auras defined yet. Create one below!</div>';
    document.getElementById('aura-settings-card').style.display = 'none';
    document.getElementById('aura-settings-empty').style.display = 'block';
    return;
  }

  auraNames.forEach(name => {
    const btn = document.createElement('div');
    btn.className = `aura-item ${selectedAuraName === name ? 'selected' : ''}`;
    btn.textContent = name;
    btn.addEventListener('click', () => {
      selectedAuraName = name;
      renderAurasTab();
      renderAuraSettings();
    });
    container.appendChild(btn);
  });
}

function renderAuraSettings() {
  if (!selectedAuraName || !config.auras[selectedAuraName]) {
    document.getElementById('aura-settings-card').style.display = 'none';
    document.getElementById('aura-settings-empty').style.display = 'block';
    return;
  }

  document.getElementById('aura-settings-card').style.display = 'block';
  document.getElementById('aura-settings-empty').style.display = 'none';
  document.getElementById('current-aura-title').textContent = `Aura Settings: ${selectedAuraName}`;

  // Populate fallback chain
  renderFallbackList();

  // Populate Add Step Provider dropdown
  const provSelect = document.getElementById('step-provider-select');
  provSelect.innerHTML = '<option value="" disabled selected>Select provider</option>';
  
  Object.keys(config.providers).filter(provKey => hasApiKey(provKey)).forEach(provKey => {
    const opt = document.createElement('option');
    opt.value = provKey;
    opt.textContent = config.providers[provKey].name || provKey;
    provSelect.appendChild(opt);
  });

  // Clear models dropdown
  const modelSelect = document.getElementById('step-model-select');
  modelSelect.innerHTML = '<option value="" disabled selected>Select model</option>';
  modelSelect.disabled = true;
}

async function updateStepModelsDropdown() {
  const providerKey = document.getElementById('step-provider-select').value;
  const modelSelect = document.getElementById('step-model-select');
  modelSelect.innerHTML = '';

  if (!providerKey) {
    modelSelect.innerHTML = '<option value="" disabled selected>Select provider first</option>';
    modelSelect.disabled = true;
    return;
  }

  modelSelect.disabled = true;
  modelSelect.innerHTML = '<option value="" disabled selected>Loading models...</option>';

  try {
    const res = await fetchJSON(`/api/providers/${providerKey}/models`);
    const models = res.models || [];

    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="" disabled selected>No models available</option>';
      modelSelect.disabled = true;
      return;
    }

    modelSelect.disabled = false;
    modelSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = 'Select model...';
    modelSelect.appendChild(placeholder);

    models.forEach(model => {
      const opt = document.createElement('option');
      opt.value = model.id;

      let contextStr = '';
      if (model.contextWindow) {
        if (model.contextWindow >= 1000000) {
          contextStr = `[Context: ${Math.round(model.contextWindow / 1000000)}M]`;
        } else {
          contextStr = `[Context: ${Math.round(model.contextWindow / 1000)}K]`;
        }
      }

      const freeStr = model.markFree ? '(Free)' : '(Paid)';
      opt.textContent = `${model.name || model.id} ${freeStr} ${contextStr}`;
      modelSelect.appendChild(opt);
    });
  } catch (err) {
    modelSelect.innerHTML = '<option value="" disabled selected>Error loading models</option>';
    modelSelect.disabled = true;
    console.error('Failed to load step models:', err);
  }
}

function renderFallbackList() {
  const chainContainer = document.getElementById('fallback-chain-list');
  chainContainer.innerHTML = '';

  const fallbacks = config.auras[selectedAuraName].fallbacks || [];
  if (fallbacks.length === 0) {
    chainContainer.innerHTML = '<div class="text-muted p-2">Fallback chain is empty. Add a step below!</div>';
    return;
  }

  fallbacks.forEach((step, idx) => {
    const item = document.createElement('div');
    item.className = 'fallback-step-item';

    const prio = document.createElement('span');
    prio.className = 'step-priority-number';
    prio.textContent = `#${idx + 1}`;

    const details = document.createElement('div');
    details.className = 'step-details';

    const provName = config.providers[step.provider]?.name || step.provider;
    details.innerHTML = `
      <span class="step-provider">${provName}</span>
      <span class="step-model">${step.model}</span>
    `;

    const actions = document.createElement('div');
    actions.className = 'step-actions';

    // Move Up Button
    const upBtn = document.createElement('button');
    upBtn.className = 'btn-arrow';
    upBtn.innerHTML = '▲';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => moveStep(idx, -1));

    // Move Down Button
    const downBtn = document.createElement('button');
    downBtn.className = 'btn-arrow';
    downBtn.innerHTML = '▼';
    downBtn.disabled = idx === fallbacks.length - 1;
    downBtn.addEventListener('click', () => moveStep(idx, 1));

    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = 'Remove';
    delBtn.addEventListener('click', () => removeStep(idx));

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(delBtn);

    item.appendChild(prio);
    item.appendChild(details);
    item.appendChild(actions);

    chainContainer.appendChild(item);
  });
}

function moveStep(index, direction) {
  const fallbacks = config.auras[selectedAuraName].fallbacks;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= fallbacks.length) return;

  // Swap elements
  const temp = fallbacks[index];
  fallbacks[index] = fallbacks[targetIndex];
  fallbacks[targetIndex] = temp;

  renderAuraSettings();
}

function removeStep(index) {
  config.auras[selectedAuraName].fallbacks.splice(index, 1);
  renderAuraSettings();
}

function addFallbackStep() {
  const provider = document.getElementById('step-provider-select').value;
  const model = document.getElementById('step-model-select').value;

  if (!provider || !model) {
    alert("Please select both a provider and a model.");
    return;
  }

  if (!config.auras[selectedAuraName].fallbacks) {
    config.auras[selectedAuraName].fallbacks = [];
  }

  // Check if same pair already exists
  const exists = config.auras[selectedAuraName].fallbacks.some(s => s.provider === provider && s.model === model);
  if (exists) {
    alert("This provider/model pair is already in the fallback list.");
    return;
  }

  config.auras[selectedAuraName].fallbacks.push({
    provider: provider,
    model: model
  });

  // Reset dropdowns
  document.getElementById('step-provider-select').value = '';
  document.getElementById('step-model-select').innerHTML = '<option value="" disabled selected>Select model</option>';
  document.getElementById('step-model-select').disabled = true;

  renderAuraSettings();
}

function createAura() {
  const input = document.getElementById('new-aura-name');
  if (!input) return;
  const name = input.value.trim().toLowerCase();
  
  if (!name) return;
  if (config.auras[name]) {
    alert("An aura with this name already exists.");
    return;
  }

  config.auras[name] = {
    fallbacks: []
  };

  input.value = '';
  selectedAuraName = name;
  renderAurasTab();
  renderAuraSettings();
  updateAurasDropdown();
}

function renameSelectedAura() {
  if (!selectedAuraName) return;
  const newName = prompt(`Enter new name for aura "${selectedAuraName}":`, selectedAuraName);
  if (!newName) return;
  const cleanedName = newName.trim().toLowerCase();
  if (cleanedName === selectedAuraName) return;
  
  if (config.auras[cleanedName]) {
    alert("An aura with this name already exists.");
    return;
  }

  config.auras[cleanedName] = config.auras[selectedAuraName];
  delete config.auras[selectedAuraName];

  selectedAuraName = cleanedName;
  renderAurasTab();
  renderAuraSettings();
  updateAurasDropdown();
}

function deleteSelectedAura() {
  if (!selectedAuraName) return;
  if (!confirm(`Are you sure you want to delete the aura "${selectedAuraName}"?`)) return;

  delete config.auras[selectedAuraName];
  selectedAuraName = null;
  renderAurasTab();
  updateAurasDropdown();
}

async function saveAurasConfig() {
  try {
    await fetchJSON('/api/auras', {
      method: 'POST',
      body: JSON.stringify({ auras: config.auras })
    });
    alert('Auras configuration saved successfully!');
    loadConfig();
  } catch (e) {
    alert('Failed to save auras configuration: ' + e.message);
  }
}

// ─── TAB 3: API Keys Management Panel ────────────────────────────────────────

function renderKeysTab() {
  const container = document.getElementById('keys-manager-container');
  container.innerHTML = '';

  visibleProvidersInKeysTab.forEach(provKey => {
    const provider = config.providers[provKey];
    if (!provider) return;
    const keys = config.keys[provKey] || [];

    // Outer accordion card
    const card = document.createElement('div');
    card.className = 'keys-accordion-card';
    card.setAttribute('data-provider', provKey);

    // Header row (always visible)
    const header = document.createElement('div');
    header.className = 'keys-accordion-header';
    header.innerHTML = `
      <div class="keys-acc-left">
        <div class="keys-acc-dots">${keys.map((_, i) => {
          return `<span class="key-dot available" title="Key ${i+1}"></span>`;
        }).join('')}${keys.length === 0 ? '<span class="key-dot inactive" title="No keys"></span>' : ''}</div>
        <div>
          <span class="keys-acc-name">${provider.name || provKey}</span>
          <span class="keys-acc-count">${keys.length} key${keys.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="keys-acc-right">
        <span class="keys-acc-chevron">▸</span>
      </div>
    `;

    // Body (collapsible)
    const body = document.createElement('div');
    body.className = 'keys-accordion-body';
    body.style.display = 'none';

    const list = document.createElement('div');
    list.className = 'keys-inputs-list';
    list.id = `keys-list-${provKey}`;
    body.appendChild(list);

    // Render existing keys
    keys.forEach(keyVal => addKeyInputRow(provKey, keyVal, list));

    // Add empty placeholder row if no keys
    if (keys.length === 0) addKeyInputRow(provKey, '', list);

    // Add Key Button
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-secondary btn-sm';
    addBtn.style.marginTop = '0.75rem';
    addBtn.textContent = '+ Add Key';
    addBtn.addEventListener('click', () => addKeyInputRow(provKey, '', list));
    body.appendChild(addBtn);

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);

    // Toggle expand/collapse
    header.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      card.classList.toggle('expanded', !isOpen);
      header.querySelector('.keys-acc-chevron').textContent = isOpen ? '▸' : '▾';
    });
  });

  // Populate the selector bar at the top: #add-key-provider-select
  const select = document.getElementById('add-key-provider-select');
  if (select) {
    select.innerHTML = '<option value="">-- Select Provider --</option>';
    
    // Sort providers by name to make selection nice
    Object.keys(config.providers)
      .filter(provId => !visibleProvidersInKeysTab.includes(provId))
      .map(provId => ({ id: provId, name: config.providers[provId].name || provId }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.name;
        select.appendChild(opt);
      });
  }
}

function addKeyInputRow(providerKey, keyValue, listContainer) {
  const list = listContainer || document.getElementById(`keys-list-${providerKey}`);
  if (!list) return;

  const row = document.createElement('div');
  row.className = 'key-input-row';

  // Support old string format and new object format
  const keyObj = typeof keyValue === 'object' && keyValue !== null && ('key' in keyValue)
    ? keyValue
    : { key: keyValue, name: '', email: '' };

  // Key Name field
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'form-input key-name';
  nameInput.placeholder = 'Label (e.g. Account 1)';
  nameInput.value = keyObj.name || '';
  row.appendChild(nameInput);

  // Email field
  const emailInput = document.createElement('input');
  emailInput.type = 'text';
  emailInput.className = 'form-input key-email';
  emailInput.placeholder = 'Email (optional)';
  emailInput.value = keyObj.email || '';
  row.appendChild(emailInput);

  if (providerKey === 'cloudflare_workers_ai') {
    // Cloudflare has special object key structure (apiToken, accountId)
    const fields = document.createElement('div');
    fields.className = 'cf-key-fields';

    const tokenInput = document.createElement('input');
    tokenInput.type = 'text';
    tokenInput.className = 'form-input cf-token';
    tokenInput.placeholder = 'API Token';
    tokenInput.value = (typeof keyObj.key === 'object' && keyObj.key !== null) ? keyObj.key.apiToken : '';

    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.className = 'form-input cf-account-id';
    idInput.placeholder = 'Account ID';
    idInput.value = (typeof keyObj.key === 'object' && keyObj.key !== null) ? keyObj.key.accountId : '';

    fields.appendChild(tokenInput);
    fields.appendChild(idInput);
    row.appendChild(fields);
  } else {
    // Standard string key input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input standard-key';
    input.placeholder = 'Paste API Key';
    input.value = (typeof keyObj.key === 'object') ? '' : (keyObj.key || '');
    row.appendChild(input);
  }

  // Remove Button
  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-danger btn-sm';
  delBtn.textContent = 'Remove';
  delBtn.addEventListener('click', () => {
    row.remove();
  });
  row.appendChild(delBtn);

  list.appendChild(row);
}

async function saveKeysConfig() {
  // Deep-clone the original config.keys to preserve credentials for providers that are not visible/rendered
  const newKeys = JSON.parse(JSON.stringify(config.keys || {}));

  // Overwrite keys only for the visible providers from the DOM inputs
  visibleProvidersInKeysTab.forEach(provKey => {
    const list = document.getElementById(`keys-list-${provKey}`);
    if (!list) return;

    newKeys[provKey] = [];

    const rows = list.querySelectorAll('.key-input-row');
    rows.forEach(row => {
      const name = row.querySelector('.key-name').value.trim();
      const email = row.querySelector('.key-email').value.trim();
      
      let keyVal = null;
      if (provKey === 'cloudflare_workers_ai') {
        const token = row.querySelector('.cf-token').value.trim();
        const accountId = row.querySelector('.cf-account-id').value.trim();
        if (token && accountId) {
          keyVal = { apiToken: token, accountId: accountId };
        }
      } else {
        const standardInput = row.querySelector('.standard-key');
        const val = standardInput ? standardInput.value.trim() : '';
        if (val) {
          keyVal = val;
        }
      }

      if (keyVal) {
        newKeys[provKey].push({
          key: keyVal,
          name: name,
          email: email
        });
      }
    });
  });

  try {
    await fetchJSON('/api/keys', {
      method: 'POST',
      body: JSON.stringify({ keys: newKeys })
    });
    alert('API Keys saved successfully!');
    loadConfig();
  } catch (e) {
    alert('Failed to save API Keys: ' + e.message);
  }
}

// ─── TAB 4: Usage Stats & Logs Dashboard (New) ──────────────────────────────

async function loadUsageFilters() {
  // Populate Aura filter dropdown
  const auraSelect = document.getElementById('filter-aura');
  if (!auraSelect) return;
  const originalVal = auraSelect.value;
  auraSelect.innerHTML = '<option value="">All Auras</option>';
  Object.keys(config.auras).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    auraSelect.appendChild(opt);
  });
  auraSelect.value = originalVal;

  // Populate Provider filter dropdown
  const provSelect = document.getElementById('filter-provider');
  const originalProv = provSelect.value;
  provSelect.innerHTML = '<option value="">All Providers</option>';
  Object.keys(config.providers).forEach(provKey => {
    const opt = document.createElement('option');
    opt.value = provKey;
    opt.textContent = config.providers[provKey].name || provKey;
    provSelect.appendChild(opt);
  });
  provSelect.value = originalProv;
}

async function loadUsageStats() {
  const startDate = document.getElementById('filter-start-date').value;
  const endDate = document.getElementById('filter-end-date').value;
  const aura = document.getElementById('filter-aura').value;
  const provider = document.getElementById('filter-provider').value;
  const host = document.getElementById('filter-host').value;
  const source = document.getElementById('filter-source').value;
  const status = document.getElementById('filter-status').value;

  const params = new URLSearchParams({
    page: logsPage,
    limit: logsLimit
  });
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  if (aura) params.append('aura', aura);
  if (provider) params.append('provider', provider);
  if (host) params.append('host', host);
  if (source) params.append('source', source);
  if (status) params.append('status', status);

  try {
    const data = await fetchJSON(`/api/usage?${params.toString()}`);
    
    // Fill metric summary numbers
    document.getElementById('stats-total-requests').textContent = data.totalCount;
    const rate = data.totalCount > 0 ? Math.round((data.successCount / data.totalCount) * 100) : 0;
    document.getElementById('stats-success-rate').textContent = `${rate}%`;
    document.getElementById('stats-avg-latency').textContent = `${data.avgLatency}ms`;
    document.getElementById('stats-total-tokens').textContent = data.totalTokens ? data.totalTokens.toLocaleString() : '0';

    // Populate Request Host filter — exclude 'Dashboard' (internal testing marker)
    const hostSelect = document.getElementById('filter-host');
    const selectedHost = hostSelect.value;
    hostSelect.innerHTML = '<option value="">All Hosts</option>';
    if (data.uniqueHosts) {
      data.uniqueHosts
        .filter(h => h && h !== 'Dashboard')
        .forEach(h => {
          const opt = document.createElement('option');
          opt.value = h;
          opt.textContent = h;
          hostSelect.appendChild(opt);
        });
    }
    hostSelect.value = selectedHost;

    // Disable host filter when source=Testing (they're the same scope)
    const sourceVal = document.getElementById('filter-source').value;
    hostSelect.disabled = sourceVal === 'Testing';
    if (sourceVal === 'Testing') hostSelect.value = '';

    // Render paginated logs table
    renderUsageLogsTable(data.logs);

    // Update pagination text
    const totalPages = Math.max(1, Math.ceil(data.totalCount / logsLimit));
    document.getElementById('pagination-info').textContent = `Page ${logsPage} of ${totalPages}`;
    document.getElementById('prev-page-btn').disabled = logsPage <= 1;
    document.getElementById('next-page-btn').disabled = logsPage >= totalPages;

    // Render Chart.js graphs
    renderUsageCharts(data.stats);
  } catch (err) {
    console.error("Failed to load usage history", err);
  }
}

function renderUsageLogsTable(logs) {
  const tbody = document.getElementById('usage-logs-tbody');
  tbody.innerHTML = '';

  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-muted" style="padding:1.5rem; text-align:center;">No request logs found matching current filters.</td></tr>';
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--color-card-border)';

    const timeTd = document.createElement('td');
    timeTd.style.padding = '8px';
    timeTd.textContent = log.timestamp;

    const hostTd = document.createElement('td');
    hostTd.style.padding = '8px';
    hostTd.textContent = log.request_host || '-';

    const sourceTd = document.createElement('td');
    sourceTd.style.padding = '8px';
    const sourceSpan = document.createElement('span');
    sourceSpan.className = `badge ${log.source === 'Testing' ? 'badge-primary' : 'badge-secondary'}`;
    sourceSpan.textContent = log.source;
    sourceTd.appendChild(sourceSpan);

    const auraTd = document.createElement('td');
    auraTd.style.padding = '8px';
    auraTd.textContent = log.aura || '-';

    const provTd = document.createElement('td');
    provTd.style.padding = '8px';
    provTd.textContent = config.providers[log.provider]?.name || log.provider || '-';

    const modelTd = document.createElement('td');
    modelTd.style.padding = '8px';
    modelTd.style.fontFamily = 'var(--font-mono)';
    modelTd.style.fontSize = '0.75rem';
    modelTd.textContent = log.model ? log.model.split('/').pop() : '-';

    const tokensTd = document.createElement('td');
    tokensTd.style.padding = '8px';
    tokensTd.style.textAlign = 'right';
    tokensTd.style.fontFamily = 'var(--font-mono)';
    tokensTd.style.fontSize = '0.75rem';
    tokensTd.textContent = log.total_tokens ? `${log.prompt_tokens}/${log.completion_tokens} (${log.total_tokens})` : '-';

    const keyTd = document.createElement('td');
    keyTd.style.padding = '8px';
    keyTd.textContent = log.key_name 
      ? `${log.key_name}` 
      : (log.key_index !== null ? `Key [${log.key_index}]` : '-');

        const proxyTd = document.createElement('td');
    proxyTd.style.padding = '8px';
    proxyTd.style.fontFamily = 'var(--font-mono)';
    proxyTd.style.fontSize = '0.75rem';
    if (log.proxy && log.proxy !== '-') {
      proxyTd.textContent = getCleanProxyHost(log.proxy);
      proxyTd.title = log.proxy;
    } else {
      proxyTd.textContent = '-';
    }

    const statusTd = document.createElement('td');
    statusTd.style.padding = '8px';
    const statusSpan = document.createElement('span');
    statusSpan.className = log.status === 'Success' ? 'text-success' : 'text-danger';
    statusSpan.textContent = log.status;
    statusTd.appendChild(statusSpan);

    const latencyTd = document.createElement('td');
    latencyTd.style.padding = '8px';
    latencyTd.style.textAlign = 'right';
    latencyTd.textContent = log.latency_ms ? `${log.latency_ms}ms` : '-';

    const actionTd = document.createElement('td');
    actionTd.style.padding = '8px';
    actionTd.style.textAlign = 'center';
    
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-secondary btn-sm';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => showLogDetails(log));
    actionTd.appendChild(viewBtn);

    tr.appendChild(timeTd);
    tr.appendChild(hostTd);
    tr.appendChild(sourceTd);
    tr.appendChild(auraTd);
    tr.appendChild(provTd);
    tr.appendChild(modelTd);
    tr.appendChild(tokensTd);
    tr.appendChild(keyTd);
    tr.appendChild(proxyTd);
    tr.appendChild(statusTd);
    tr.appendChild(latencyTd);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });
}

function showLogDetails(log) {
  document.getElementById('modal-timestamp').textContent = log.timestamp;
  document.getElementById('modal-source').textContent = log.source;
  document.getElementById('modal-aura').textContent = log.aura || '-';
  document.getElementById('modal-prov-model').textContent = `${log.provider || '-'} / ${log.model || '-'}`;
  document.getElementById('modal-key').textContent = log.key_name 
    ? `${log.key_name} (${log.key_email || 'No email'})` 
    : (log.key_index !== null ? `Key [${log.key_index}]` : '-');
  document.getElementById('modal-proxy').textContent = log.proxy || 'direct';
  document.getElementById('modal-status').textContent = log.status;
  document.getElementById('modal-status').className = `info-val ${log.status === 'Success' ? 'text-success' : 'text-danger'}`;
  document.getElementById('modal-latency').textContent = (log.latency_ms ? `${log.latency_ms}ms` : '-') + (log.total_tokens ? ` | Tokens: ${log.prompt_tokens}p + ${log.completion_tokens}c = ${log.total_tokens}t` : '');

  // Format Prompt JSON array to clean text
  let promptText = log.prompt;
  try {
    const parsed = JSON.parse(log.prompt);
    if (Array.isArray(parsed)) {
      promptText = parsed.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n');
    }
  } catch (e) {
    // leave as raw string
  }
  document.getElementById('modal-prompt').textContent = promptText;
  document.getElementById('modal-response').textContent = log.response || (log.error_message ? `Error details: ${log.error_message}` : '-');

  document.getElementById('log-details-modal').style.display = 'flex';
}

function renderUsageCharts(stats) {
  // Chart 1: Requests Over Time (Line Chart)
  const timeLabels = stats.timeSeries.map(d => d.date);
  const timeCounts = stats.timeSeries.map(d => d.count);

  if (chartRequestsTime) chartRequestsTime.destroy();
  const ctxTime = document.getElementById('chart-requests-time').getContext('2d');
  chartRequestsTime = new Chart(ctxTime, {
    type: 'line',
    data: {
      labels: timeLabels.length > 0 ? timeLabels : ['No Data'],
      datasets: [{
        label: 'Requests',
        data: timeCounts.length > 0 ? timeCounts : [0],
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        borderWidth: 2,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#9ca3af' }
        },
        x: {
          grid: { display: false },
          ticks: { color: '#9ca3af' }
        }
      }
    }
  });

  // Chart 2: Provider Distribution (Doughnut Chart)
  const provLabels = stats.providers.map(d => config.providers[d.provider]?.name || d.provider || 'Error/Unknown');
  const provCounts = stats.providers.map(d => d.count);

  if (chartProvidersPie) chartProvidersPie.destroy();
  const ctxPie = document.getElementById('chart-providers-pie').getContext('2d');
  chartProvidersPie = new Chart(ctxPie, {
    type: 'doughnut',
    data: {
      labels: provLabels.length > 0 ? provLabels : ['No Data'],
      datasets: [{
        data: provCounts.length > 0 ? provCounts : [1],
        backgroundColor: [
          '#6366f1', '#10b981', '#f59e0b', '#f43f5e', 
          '#8b5cf6', '#ec4899', '#3b82f6', '#14b8a6'
        ],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#f3f4f6', boxWidth: 12, font: { size: 10 } }
        }
      }
    }
  });
}

// ─── TAB 5: Provider & Models Configuration Panel (New) ─────────────────────

function renderProvidersTab() {
  const container = document.getElementById('providers-selector-container');
  container.innerHTML = '';

  const providerKeys = Object.keys(config.providers).filter(key => hasApiKey(key));
  if (providerKeys.length === 0) {
    selectedProviderName = null;
    container.innerHTML = '<div class="text-muted p-3">No active providers configured with API keys. Set up credentials in the API Keys tab first!</div>';
    document.getElementById('provider-settings-card').style.display = 'none';
    document.getElementById('provider-settings-empty').style.display = 'block';
    return;
  }

  if (!selectedProviderName || !providerKeys.includes(selectedProviderName)) {
    selectedProviderName = providerKeys[0];
  }

  providerKeys.forEach(key => {
    const btn = document.createElement('div');
    btn.className = `aura-item ${selectedProviderName === key ? 'selected' : ''}`;
    btn.textContent = config.providers[key].name || key;
    btn.addEventListener('click', () => {
      selectedProviderName = key;
      renderProvidersTab();
      renderProviderSettings();
    });
    container.appendChild(btn);
  });
}

async function renderProviderSettings() {
  if (!selectedProviderName || !config.providers[selectedProviderName]) {
    document.getElementById('provider-settings-card').style.display = 'none';
    document.getElementById('provider-settings-empty').style.display = 'block';
    return;
  }

  const provider = config.providers[selectedProviderName];

  document.getElementById('provider-settings-card').style.display = 'block';
  document.getElementById('provider-settings-empty').style.display = 'none';
  document.getElementById('current-provider-title').textContent = `Provider Config: ${provider.name || selectedProviderName}`;

  // Fill form inputs
  document.getElementById('provider-display-name').value = provider.name || '';
  document.getElementById('provider-base-url').value = provider.baseUrl || '';
  document.getElementById('provider-auth-header').value = provider.authHeader || 'Authorization';
  document.getElementById('provider-auth-prefix').value = provider.authPrefix || 'Bearer';
  document.getElementById('provider-cooldown').value = provider.cooldownTime || '';
  document.getElementById('provider-notes').value = provider.notes || '';

  // Render models list
  await renderProviderModelsList();
}

async function renderProviderModelsList() {
  const tbody = document.getElementById('provider-models-tbody');
  tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="padding:1rem; text-align:center;">Loading models from provider API...</td></tr>';

  try {
    const res = await fetchJSON(`/api/providers/${selectedProviderName}/models`);
    const models = res.models || [];

    if (models.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted" style="padding:1rem; text-align:center;">No models found. Ensure your API keys are configured and base URL is correct.</td></tr>';
      return;
    }

    tbody.innerHTML = '';

    models.forEach((model) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--color-card-border)';

      const idTd = document.createElement('td');
      idTd.style.padding = '6px';
      idTd.style.fontFamily = 'var(--font-mono)';
      idTd.style.fontSize = '0.8rem';
      idTd.textContent = model.id;

      const nameTd = document.createElement('td');
      nameTd.style.padding = '6px';
      nameTd.textContent = model.name || '-';

      const contextTd = document.createElement('td');
      contextTd.style.padding = '6px';
      contextTd.style.textAlign = 'right';
      contextTd.textContent = model.contextWindow ? model.contextWindow.toLocaleString() : '-';

      const limitTd = document.createElement('td');
      limitTd.style.padding = '6px';
      limitTd.style.textAlign = 'right';
      const inputLimit = model.contextWindow ? model.contextWindow.toLocaleString() : '-';
      const outputLimit = model.maxOutput ? model.maxOutput.toLocaleString() : '-';
      limitTd.textContent = `${inputLimit} / ${outputLimit}`;

      const capabilitiesTd = document.createElement('td');
      capabilitiesTd.style.padding = '6px';
      capabilitiesTd.style.textAlign = 'center';
      const caps = model.capabilities || ['text'];
      capabilitiesTd.textContent = caps.join(', ');

      const reasoningTd = document.createElement('td');
      reasoningTd.style.padding = '6px';
      reasoningTd.style.textAlign = 'center';
      reasoningTd.innerHTML = model.reasoning ? '<span class="text-success">Yes</span>' : '<span class="text-danger">No</span>';

      const pricingTd = document.createElement('td');
      pricingTd.style.padding = '6px';
      pricingTd.style.textAlign = 'right';
      if (model.pricing) {
        const pPrompt = parseFloat(model.pricing.prompt);
        const pCompletion = parseFloat(model.pricing.completion);
        if (pPrompt === 0 && pCompletion === 0) {
          pricingTd.innerHTML = '<span class="text-success">Free</span>';
        } else {
          const prompt1M = (pPrompt * 1e6).toFixed(2);
          const completion1M = (pCompletion * 1e6).toFixed(2);
          pricingTd.textContent = `$${prompt1M} / $${completion1M}`;
        }
      } else {
        pricingTd.textContent = '-';
      }

      // Mark Free Toggle Checkbox
      const freeTd = document.createElement('td');
      freeTd.style.padding = '6px';
      freeTd.style.textAlign = 'center';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!model.markFree;
      checkbox.style.cursor = 'pointer';
      checkbox.addEventListener('change', async () => {
        try {
          await fetchJSON(`/api/providers/${selectedProviderName}/models/settings`, {
            method: 'POST',
            body: JSON.stringify({
              modelId: model.id,
              markFree: checkbox.checked
            })
          });
        } catch (err) {
          alert('Failed to save free setting: ' + err.message);
          checkbox.checked = !checkbox.checked; // revert
        }
      });
      freeTd.appendChild(checkbox);

      tr.appendChild(idTd);
      tr.appendChild(nameTd);
      tr.appendChild(contextTd);
      tr.appendChild(limitTd);
      tr.appendChild(capabilitiesTd);
      tr.appendChild(reasoningTd);
      tr.appendChild(pricingTd);
      tr.appendChild(freeTd);
      tbody.appendChild(tr);
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-danger" style="padding:1rem; text-align:center;">Failed to fetch models: ${err.message}</td></tr>`;
  }
}

function createProvider() {
  const input = document.getElementById('new-provider-name');
  const key = input.value.trim().toLowerCase();

  if (!key) return;
  if (config.providers[key]) {
    alert("A provider with this ID already exists.");
    return;
  }

  config.providers[key] = {
    name: key.toUpperCase(),
    baseUrl: '',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    models: []
  };

  input.value = '';
  selectedProviderName = key;
  renderProvidersTab();
  renderProviderSettings();
}

function deleteSelectedProvider() {
  if (!selectedProviderName) return;
  if (!confirm(`Are you sure you want to delete the provider "${selectedProviderName}"? This will delete all its models.`)) return;

  delete config.providers[selectedProviderName];
  
  // Clean keys associated with this provider
  if (config.keys[selectedProviderName]) {
    delete config.keys[selectedProviderName];
  }

  selectedProviderName = null;
  renderProvidersTab();
}

async function saveProvidersConfig() {
  if (!selectedProviderName || !config.providers[selectedProviderName]) return;

  const provider = config.providers[selectedProviderName];

  // Update parameters from form fields
  provider.name = document.getElementById('provider-display-name').value.trim();
  provider.baseUrl = document.getElementById('provider-base-url').value.trim();
  provider.authHeader = document.getElementById('provider-auth-header').value.trim();
  provider.authPrefix = document.getElementById('provider-auth-prefix').value.trim();
  
  const cooldownVal = parseInt(document.getElementById('provider-cooldown').value);
  provider.cooldownTime = isNaN(cooldownVal) ? null : cooldownVal;
  
  provider.notes = document.getElementById('provider-notes').value.trim();

  try {
    await fetchJSON('/api/providers', {
      method: 'POST',
      body: JSON.stringify({ providers: config.providers })
    });
    alert('Provider configuration saved successfully!');
    loadConfig();
    renderProvidersTab();
  } catch (err) {
    alert('Failed to save provider config: ' + err.message);
  }
}

// ─── Proxy Status Polling & Rendering ────────────────────────────────────────
let proxyPollingTimer = null;

function startProxyStatusPolling() {
  updateProxyStatus();
  proxyPollingTimer = setInterval(updateProxyStatus, 4000);
}

async function updateProxyStatus() {
  try {
    const data = await fetchJSON('/api/proxies');
    const statusVal = document.getElementById('proxy-pool-status');
    if (statusVal) {
      statusVal.textContent = data.status;
      if (data.status.includes('Active')) {
        statusVal.className = 'stat-val text-success';
      } else if (data.status.includes('Scraping') || data.status.includes('Testing') || data.status.includes('Refreshing')) {
        statusVal.className = 'stat-val text-warning';
      } else if (data.status.includes('Disabled')) {
        statusVal.className = 'stat-val text-muted';
      } else {
        statusVal.className = 'stat-val text-danger';
      }
    }

    // Disable/enable manual refresh button
    const refreshBtn = document.getElementById('refresh-proxies-btn');
    if (refreshBtn) {
      const statusL = data.status.toLowerCase();
      const isRefreshing = statusL.includes('refreshing') || statusL.includes('scraping') || statusL.includes('testing') || statusL.includes('crawling');
      
      if (data.status.includes('Disabled')) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Force Refresh the Proxy Pool';
        refreshBtn.title = 'Enable IP Masking in Proxy Configuration to refresh';
        refreshBtn.style.opacity = '0.5';
        refreshBtn.style.cursor = 'not-allowed';
      } else if (isRefreshing) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
        refreshBtn.title = 'Proxy pool refresh is currently in progress...';
        refreshBtn.style.opacity = '0.7';
        refreshBtn.style.cursor = 'wait';
      } else {
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Force Refresh the Proxy Pool';
        refreshBtn.title = '';
        refreshBtn.style.opacity = '1';
        refreshBtn.style.cursor = 'pointer';
      }
    }

    // Also update the logs tab proxy status
    const logsProxy = document.getElementById('logs-proxy-status');
    if (logsProxy) {
      const poolCount = data.pool ? data.pool.length : 0;
      logsProxy.textContent = data.status.includes('Active')
        ? `${poolCount} proxies active`
        : data.status;
      logsProxy.style.color = data.status.includes('Active')
        ? 'var(--color-success)'
        : data.status.includes('Scraping') || data.status.includes('Testing') || data.status.includes('Refreshing')
          ? 'var(--color-warning)'
          : data.status.includes('Disabled')
            ? 'var(--color-text-muted)'
            : 'var(--color-danger)';
    }

        // Update proxy analytics counters
    const total = data.analytics?.totalMaskedRequests || 0;
    const success = data.analytics?.successfulMaskedRequests || 0;
    const direct = data.analytics?.directRequests || 0;
    const rate = total > 0 ? Math.round((success / total) * 100) : 0;

    const statMasked = document.getElementById('stat-masked-requests');
    const statSuccess = document.getElementById('stat-masked-success');
    const statDirect = document.getElementById('stat-direct-requests');
    const statRate = document.getElementById('stat-masked-rate');

    if (statMasked) statMasked.textContent = total;
    if (statSuccess) statSuccess.textContent = success;
    if (statDirect) statDirect.textContent = direct;
    if (statRate) statRate.textContent = `${rate}%`;

    renderProxyTable(data.pool);
    renderSourceRankings(data.rankedBySuccess, data.rankedByLatency);
    loadProxyRefreshHistory();
  } catch (err) {
    const statusVal = document.getElementById('proxy-pool-status');
    if (statusVal) { statusVal.textContent = 'Error'; statusVal.className = 'stat-val text-danger'; }
    const logsProxy = document.getElementById('logs-proxy-status');
    if (logsProxy) { logsProxy.textContent = 'Error'; logsProxy.style.color = 'var(--color-danger)'; }
  }
}

function renderProxyTable(pool) {
  const tbody = document.getElementById('proxy-pool-table-body');
  tbody.innerHTML = '';

  if (!pool || pool.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-muted" style="padding:1rem; text-align:center;">No active proxies. Direct connections will be used.</td></tr>';
    return;
  }

  pool.forEach((proxy, idx) => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--color-card-border)';

    // Index column
    const indexTd = document.createElement('td');
    indexTd.style.padding = '6px 8px';
    indexTd.style.color = 'var(--color-text-muted)';
    indexTd.textContent = idx + 1;

    // Proxy URL column
    const urlTd = document.createElement('td');
    urlTd.style.padding = '6px 8px';
    urlTd.style.fontFamily = 'var(--font-mono)';
    urlTd.textContent = proxy.url;

    // Source URL column (clickable clean name)
    const sourceTd = document.createElement('td');
    sourceTd.style.padding = '6px 8px';
    const sourceLink = document.createElement('a');
    sourceLink.href = proxy.source;
    sourceLink.target = '_blank';
    sourceLink.style.color = 'var(--color-primary)';
    sourceLink.style.textDecoration = 'none';
    sourceLink.style.fontWeight = '500';
    sourceLink.textContent = getCleanSourceName(proxy.source);
    sourceLink.title = proxy.source;
    sourceTd.appendChild(sourceLink);

    // Created At column
    const createdTd = document.createElement('td');
    createdTd.style.padding = '6px 8px';
    createdTd.style.textAlign = 'center';
    createdTd.style.color = 'var(--color-text-muted)';
    createdTd.textContent = formatDateTime(proxy.createdAt);

    // Latency speed column
    const speedTd = document.createElement('td');
    speedTd.style.padding = '6px 8px';
    speedTd.style.textAlign = 'right';
    
    const span = document.createElement('span');
    span.textContent = `${proxy.latency}ms`;
    if (proxy.latency < 500) {
      span.className = 'text-success';
    } else if (proxy.latency < 1500) {
      span.className = 'text-warning';
    } else {
      span.className = 'text-danger';
    }
    
    speedTd.appendChild(span);
    tr.appendChild(indexTd);
    tr.appendChild(urlTd);
    tr.appendChild(sourceTd);
    tr.appendChild(createdTd);
    tr.appendChild(speedTd);
    tbody.appendChild(tr);
  });
}

async function loadProxyRefreshHistory() {
  const tbody = document.getElementById('proxy-refresh-history-tbody');
  if (!tbody) return;

  try {
    const data = await fetchJSON('/api/proxies/refresh-history');
    if (!data.success) throw new Error(data.error || 'Unknown error');

    tbody.innerHTML = '';
    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="padding:1rem; text-align:center;">No history available.</td></tr>';
      return;
    }

    data.logs.forEach(log => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--color-card-border)';

      // Cause column
      const causeTd = document.createElement('td');
      causeTd.style.padding = '6px 4px';
      
      let badgeStyle = '';
      if (log.trigger_cause === 'replenishing') {
        badgeStyle = 'background: rgba(59, 130, 246, 0.12); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.25);';
      } else if (log.trigger_cause === 'onstart_server') {
        badgeStyle = 'background: rgba(139, 92, 246, 0.12); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.25);';
      } else if (log.trigger_cause === 'user_triggered') {
        badgeStyle = 'background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.25);';
      }
      
      const badge = document.createElement('span');
      badge.style.cssText = badgeStyle + ' padding: 2px 4px; border-radius: 4px; font-weight: 500; font-size: 0.65rem;';
      badge.textContent = log.trigger_cause;
      causeTd.appendChild(badge);

      // Triggered time column
      const timeTd = document.createElement('td');
      timeTd.style.padding = '6px 4px';
      timeTd.textContent = formatDateTime(log.triggered_time);
      timeTd.title = log.triggered_time;

      // Active before column
      const beforeTd = document.createElement('td');
      beforeTd.style.padding = '6px 4px';
      beforeTd.style.textAlign = 'center';
      beforeTd.textContent = log.active_before;

      // Status column
      const statusTd = document.createElement('td');
      statusTd.style.padding = '6px 4px';
      statusTd.style.textAlign = 'center';
      
      const statusSpan = document.createElement('span');
      if (log.status === 'running') {
        statusSpan.className = 'text-warning';
        statusSpan.style.display = 'inline-flex';
        statusSpan.style.alignItems = 'center';
        statusSpan.style.gap = '4px';
        
        const dot = document.createElement('span');
        dot.className = 'status-indicator online';
        dot.style.background = 'var(--color-warning)';
        dot.style.boxShadow = '0 0 6px var(--color-warning)';
        statusSpan.appendChild(dot);
        statusSpan.appendChild(document.createTextNode('running'));
      } else {
        statusSpan.className = 'text-success';
        statusSpan.style.display = 'inline-flex';
        statusSpan.style.alignItems = 'center';
        statusSpan.style.gap = '4px';
        
        const dot = document.createElement('span');
        dot.className = 'status-indicator online';
        statusSpan.appendChild(dot);
        statusSpan.appendChild(document.createTextNode('done'));
      }
      statusTd.appendChild(statusSpan);

      // Running time (Duration)
      const tookTd = document.createElement('td');
      tookTd.style.padding = '6px 4px';
      tookTd.style.textAlign = 'right';
      if (log.status === 'running' || log.running_time === null || log.running_time === undefined) {
        tookTd.textContent = '—';
      } else {
        tookTd.textContent = `${log.running_time.toFixed(2)} min`;
      }

      // Harvested count column
      const scrapedTd = document.createElement('td');
      scrapedTd.style.padding = '6px 4px';
      scrapedTd.style.textAlign = 'center';
      scrapedTd.textContent = log.harvested_count ?? 0;

      // Tested count column
      const testedTd = document.createElement('td');
      testedTd.style.padding = '6px 4px';
      testedTd.style.textAlign = 'center';
      testedTd.textContent = log.tested_count ?? 0;

      // Passed count column
      const passedTd = document.createElement('td');
      passedTd.style.padding = '6px 4px';
      passedTd.style.textAlign = 'center';
      passedTd.textContent = log.passed_anomality_stage_count ?? 0;

      tr.appendChild(causeTd);
      tr.appendChild(timeTd);
      tr.appendChild(beforeTd);
      tr.appendChild(statusTd);
      tr.appendChild(tookTd);
      tr.appendChild(scrapedTd);
      tr.appendChild(testedTd);
      tr.appendChild(passedTd);
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load proxy refresh history:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-danger" style="padding:1rem; text-align:center;">Failed to load history: ${err.message}</td></tr>`;
  }
}

async function triggerProxyRefresh() {
  const btn = document.getElementById('refresh-proxies-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  btn.style.cursor = 'wait';
  try {
    const res = await fetchJSON('/api/proxies/refresh', { method: 'POST' });
    await updateProxyStatus();
  } catch (e) {
    console.error(e);
    alert('Failed to trigger proxy refresh: ' + e.message);
    await updateProxyStatus();
  }
}

async function renderProxiesTab() {
  try {
    const data = await fetchJSON('/api/settings');
    const slider = document.getElementById('proxy-latency-threshold-slider');
    const sliderVal = document.getElementById('proxy-latency-threshold-val');
    const enableToggle = document.getElementById('proxy-enable-toggle');
    if (slider && sliderVal && data.latencyThreshold !== undefined) {
      slider.value = data.latencyThreshold;
      sliderVal.textContent = data.latencyThreshold + 'ms';
    }
    if (enableToggle && data.enableProxy !== undefined) {
      enableToggle.checked = !!data.enableProxy;
    }
    loadProxyRefreshHistory();
  } catch (err) {
    console.error("Failed to load proxy settings:", err);
  }
}

async function saveProxySettings() {
  const slider = document.getElementById('proxy-latency-threshold-slider');
  const enableToggle = document.getElementById('proxy-enable-toggle');
  if (!slider || !enableToggle) return;
  const threshold = parseInt(slider.value, 10);
  const enableProxy = enableToggle.checked;
  try {
    const res = await fetchJSON('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ latencyThreshold: threshold, enableProxy })
    });
    if (res.success) {
      alert('Proxy settings saved successfully!');
      updateProxyStatus();
    }
  } catch (err) {
    alert('Failed to save proxy settings: ' + err.message);
  }
}

function getCleanSourceName(urlStr) {
  if (!urlStr) return 'Unknown';
  try {
    const url = new URL(urlStr);
    const page = url.searchParams.get('page');
    const pageSuffix = page ? ` (Page ${page})` : '';

    if (url.hostname === 'raw.githubusercontent.com') {
      const parts = url.pathname.split('/');
      // pathname starts with '/' so parts[0] is empty. parts[1] is owner, parts[2] is repo, parts[3] is branch/ref.
      if (parts.length >= 3) {
        const owner = parts[1];
        const repo = parts[2];
        const filename = parts[parts.length - 1];
        return `${owner}/${repo}/${filename}${pageSuffix}`;
      }
      const filename = parts.pop();
      return (filename || 'github-raw') + pageSuffix;
    }
    let host = url.hostname;
    if (host.startsWith('api.')) {
      host = host.substring(4);
    }
    if (host.startsWith('proxylist.')) {
      host = host.substring(10);
    }
    return (host || 'Unknown') + pageSuffix;
  } catch (e) {
    try {
      const filename = urlStr.split('/').pop().split('?')[0];
      return filename || 'Unknown';
    } catch (err) {
      return 'Unknown';
    }
  }
}

function renderSourceRankings(rankedBySuccess, rankedByLatency) {
  const successTbody = document.getElementById('proxy-source-success-tbody');
  const latencyTbody = document.getElementById('proxy-source-latency-tbody');

  if (successTbody && rankedBySuccess) {
    successTbody.innerHTML = '';
    rankedBySuccess.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--color-card-border)';
      
      const sourceName = getCleanSourceName(row.source);

      tr.innerHTML = `
        <td style="padding: 6px; color: var(--color-text-muted); font-weight: 500; text-align: center;">${idx + 1}</td>
        <td style="padding: 6px; font-family: var(--font-mono); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${row.source}">
          <a href="${row.source}" target="_blank" style="color: var(--color-primary); text-decoration: none;" class="source-link">${sourceName}</a>
        </td>
        <td style="padding: 6px; text-align: center; color: var(--color-success);">${row.success}</td>
        <td style="padding: 6px; text-align: center; color: var(--color-danger);">${row.failure}</td>
        <td style="padding: 6px; text-align: right; font-weight: 600;">${row.successRate}%</td>
      `;
      successTbody.appendChild(tr);
    });
  }

  if (latencyTbody && rankedByLatency) {
    latencyTbody.innerHTML = '';
    rankedByLatency.forEach((row, idx) => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--color-card-border)';
      
      const sourceName = getCleanSourceName(row.source);
      const avgSpeed = row.avgLatency > 0 ? `${row.avgLatency}ms` : '—';

      tr.innerHTML = `
        <td style="padding: 6px; color: var(--color-text-muted); font-weight: 500; text-align: center;">${idx + 1}</td>
        <td style="padding: 6px; font-family: var(--font-mono); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${row.source}">
          <a href="${row.source}" target="_blank" style="color: var(--color-primary); text-decoration: none;" class="source-link">${sourceName}</a>
        </td>
        <td style="padding: 6px; text-align: center;">${row.success}</td>
        <td style="padding: 6px; text-align: right; font-weight: 600; color: ${row.avgLatency > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)'};">${avgSpeed}</td>
      `;
      latencyTbody.appendChild(tr);
    });
  }
}

function hasApiKey(providerId) {
  const keys = config.keys && config.keys[providerId];
  if (!keys || !Array.isArray(keys) || keys.length === 0) return false;
  return keys.some(k => {
    if (!k) return false;
    if (typeof k === 'object') {
      if (providerId === 'cloudflare_workers_ai') {
        const val = k.key;
        if (val && typeof val === 'object') {
          return !!(val.apiToken && val.accountId);
        }
        return false;
      }
      return !!k.key;
    }
    return !!k;
  });
}

async function refreshProviderModels() {
  if (!selectedProviderName) {
    alert('Please select a provider first.');
    return;
  }
  const btn = document.getElementById('refresh-provider-models-btn');
  if (!btn) return;
  
  btn.disabled = true;
  const oldHTML = btn.innerHTML;
  btn.textContent = 'Refreshing...';
  try {
    const res = await fetchJSON(`/api/providers/${selectedProviderName}/models?refresh=true`);
    alert('Provider models refreshed successfully from the live API!');
    await renderProviderModelsList();
  } catch (err) {
    alert('Failed to refresh provider models: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldHTML;
  }
}

function renderSupportedProvidersTab() {
  const tbody = document.getElementById('supported-providers-tbody');
  if (!tbody) return;

  tbody.innerHTML = '';
  
  // Sort providers alphabetically by name
  const sortedKeys = Object.keys(config.providers).sort((a, b) => {
    const nameA = config.providers[a].name || a;
    const nameB = config.providers[b].name || b;
    return nameA.localeCompare(nameB);
  });

  sortedKeys.forEach(provId => {
    const prov = config.providers[provId];
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--color-card-border)';

    // Provider
    const nameTd = document.createElement('td');
    nameTd.style.padding = '10px 8px';
    nameTd.style.fontWeight = 'bold';
    nameTd.textContent = prov.name || provId;
    
    // Description / Notes
    const descTd = document.createElement('td');
    descTd.style.padding = '10px 8px';
    descTd.textContent = prov.notes || '-';

    // Free Tier badge
    const freeTd = document.createElement('td');
    freeTd.style.padding = '10px 8px';
    freeTd.style.textAlign = 'center';
    const hasFree = prov.signupRequirements && prov.signupRequirements.freeTier;
    const freeBadge = document.createElement('span');
    if (hasFree) {
      freeBadge.style.cssText = 'background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-size: 0.75rem;';
      freeBadge.textContent = 'Yes';
    } else {
      freeBadge.style.cssText = 'background: rgba(107, 114, 128, 0.15); color: #9ca3af; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-size: 0.75rem;';
      freeBadge.textContent = 'No';
    }
    freeTd.appendChild(freeBadge);

    // Card Required badge
    const cardTd = document.createElement('td');
    cardTd.style.padding = '10px 8px';
    cardTd.style.textAlign = 'center';
    const cardReq = prov.signupRequirements && prov.signupRequirements.cardRequired;
    const cardBadge = document.createElement('span');
    if (cardReq) {
      cardBadge.style.cssText = 'background: rgba(239, 68, 68, 0.15); color: #ef4444; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-size: 0.75rem;';
      cardBadge.textContent = 'Required';
    } else {
      cardBadge.style.cssText = 'background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-size: 0.75rem;';
      cardBadge.textContent = 'No';
    }
    cardTd.appendChild(cardBadge);

    // Phone Required badge
    const phoneTd = document.createElement('td');
    phoneTd.style.padding = '10px 8px';
    phoneTd.style.textAlign = 'center';
    const phoneReq = prov.signupRequirements && prov.signupRequirements.phoneRequired;
    const phoneBadge = document.createElement('span');
    if (phoneReq) {
      phoneBadge.style.cssText = 'background: rgba(245, 158, 11, 0.15); color: #f59e0b; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-size: 0.75rem;';
      phoneBadge.textContent = 'Required';
    } else {
      phoneBadge.style.cssText = 'background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 2px 8px; border-radius: 4px; font-weight: 500; font-size: 0.75rem;';
      phoneBadge.textContent = 'No';
    }
    phoneTd.appendChild(phoneBadge);

    // Sign Up link
    const signupTd = document.createElement('td');
    signupTd.style.padding = '10px 8px';
    signupTd.style.textAlign = 'center';
    if (prov.signup) {
      const link = document.createElement('a');
      link.href = prov.signup;
      link.target = '_blank';
      link.style.cssText = 'color: var(--color-primary); text-decoration: none; font-weight: 500;';
      link.textContent = 'Sign Up ↗';
      signupTd.appendChild(link);
    } else {
      signupTd.textContent = '-';
    }

    tr.appendChild(nameTd);
    tr.appendChild(descTd);
    tr.appendChild(freeTd);
    tr.appendChild(cardTd);
    tr.appendChild(phoneTd);
    tr.appendChild(signupTd);
    
    tbody.appendChild(tr);
  });
}

