// Global State
let config = {
  providers: {},
  agents: {},
  keys: {},
  ips: []
};

let activeTab = 'tab-dashboard';
let selectedAgentName = null;
let selectedProviderName = null;
let healthTimer = null;
let uptimeTimer = null;
let startTime = Date.now();

// Usage tab state
let logsPage = 1;
const logsLimit = 15;
let chartRequestsTime = null;
let chartProvidersPie = null;

// ─── Initializer ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Restore persisted tab if present
  const persistedTab = localStorage.getItem('activeTab');
  if (persistedTab && document.getElementById(persistedTab)) {
    activeTab = persistedTab;
  }

  initTabs();
  initLogStream();
  loadConfig();
  
  // Dashboard event listeners
  document.getElementById('refresh-proxies-btn').addEventListener('click', triggerProxyRefresh);
  document.getElementById('api-test-form').addEventListener('submit', runApiTest);
  document.getElementById('clear-response-btn').addEventListener('click', () => {
    document.getElementById('json-response-output').textContent = 'Ready to test.';
  });
  document.getElementById('clear-logs-btn').addEventListener('click', () => {
    document.getElementById('logs-terminal').innerHTML = '<div class="log-line system">[system] Logs cleared.</div>';
  });

  // Agents event listeners
  document.getElementById('create-agent-btn').addEventListener('click', createAgent);
  document.getElementById('rename-agent-btn').addEventListener('click', renameSelectedAgent);
  document.getElementById('delete-agent-btn').addEventListener('click', deleteSelectedAgent);
  document.getElementById('step-provider-select').addEventListener('change', updateStepModelsDropdown);
  document.getElementById('add-step-btn').addEventListener('click', addFallbackStep);
  document.getElementById('save-agents-btn').addEventListener('click', saveAgentsConfig);

  // Keys event listeners
  document.getElementById('save-keys-btn').addEventListener('click', saveKeysConfig);

  // Providers event listeners
  document.getElementById('create-provider-btn').addEventListener('click', createProvider);
  document.getElementById('delete-provider-btn').addEventListener('click', deleteSelectedProvider);
  document.getElementById('add-provider-model-btn').addEventListener('click', addProviderModel);
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

  // Start status polling
  startStatusPolling();
  startUptimeCounter();
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
      localStorage.setItem('activeTab', activeTab);
      
      triggerTabLoad(activeTab);
    });
  });
}

function triggerTabLoad(tabName) {
  if (tabName === 'tab-dashboard') {
    loadUsageFilters();
    loadUsageStats();
  } else if (tabName === 'tab-tester') {
    updateAgentsDropdown();
  } else if (tabName === 'tab-agents') {
    renderAgentsTab();
  } else if (tabName === 'tab-keys') {
    renderKeysTab();
  } else if (tabName === 'tab-providers') {
    renderProvidersTab();
  }
}

// ─── Live Log Streaming (SSE) ────────────────────────────────────────────────

function initLogStream() {
  const logsTerminal = document.getElementById('logs-terminal');
  const eventSource = new EventSource('/api/logs-stream');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      const line = document.createElement('div');
      line.className = `log-line ${data.level || 'info'}`;
      
      const timeStr = new Date(data.timestamp).toLocaleTimeString();
      line.textContent = `[${timeStr}] ${data.message}`;
      
      logsTerminal.appendChild(line);
      logsTerminal.scrollTop = logsTerminal.scrollHeight;
    } catch (e) {
      console.error("Error parsing log line:", e);
    }
  };

  eventSource.onerror = () => {
    const line = document.createElement('div');
    line.className = 'log-line error';
    line.textContent = `[${new Date().toLocaleTimeString()}] [system] Log stream connection lost. Retrying...`;
    logsTerminal.appendChild(line);
  };
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
    renderUIPool();
    updateAgentsDropdown();
  } catch (err) {
    console.error("Failed to load configs", err);
  }
}

// ─── Uptime & Health Polling ──────────────────────────────────────────────────

function startUptimeCounter() {
  const uptimeSpan = document.getElementById('server-uptime');
  setInterval(() => {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    if (seconds < 60) {
      uptimeSpan.textContent = `${seconds}s`;
    } else if (seconds < 3600) {
      uptimeSpan.textContent = `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    } else {
      uptimeSpan.textContent = `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    }
  }, 1000);
}

function startStatusPolling() {
  updateHealthStatus();
  healthTimer = setInterval(updateHealthStatus, 5000);
}

async function updateHealthStatus() {
  try {
    const res = await fetch('/status');
    if (!res.ok) throw new Error("Offline");
    const data = await res.json();
    
    document.getElementById('server-status').textContent = 'Online';
    document.getElementById('server-status').className = 'stat-val text-success';
    
    renderHealthGrid(data.keyStates);
  } catch (err) {
    document.getElementById('server-status').textContent = 'Offline';
    document.getElementById('server-status').className = 'stat-val text-danger';
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
  document.getElementById('server-agents-count').textContent = Object.keys(config.agents).length;
}

// ─── API Tester ──────────────────────────────────────────────────────────────

function updateAgentsDropdown() {
  const select = document.getElementById('test-agent-select');
  select.innerHTML = '';

  const agentNames = Object.keys(config.agents);
  if (agentNames.length === 0) {
    select.innerHTML = '<option value="" disabled selected>No agents configured</option>';
    select.disabled = true;
    document.getElementById('agent-warning').style.display = 'block';
    return;
  }

  select.disabled = false;
  document.getElementById('agent-warning').style.display = 'none';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Select an agent...';
  select.appendChild(placeholder);

  agentNames.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = `aurora-provider/${name}`;
    select.appendChild(opt);
  });
}

async function runApiTest(e) {
  e.preventDefault();
  const agent = document.getElementById('test-agent-select').value;
  const prompt = document.getElementById('test-prompt').value;
  const stream = document.getElementById('test-stream').checked;
  const output = document.getElementById('json-response-output');
  const runBtn = document.getElementById('run-test-btn');

  if (!agent) {
    alert("Please select an agent to test.");
    return;
  }

  runBtn.disabled = true;
  runBtn.textContent = 'Executing...';
  output.textContent = 'Routing request and waiting for response...';

  try {
    const payload = {
      model: `aurora-provider/${agent}`,
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

// ─── TAB 2: Agents Config ────────────────────────────────────────────────────

function renderAgentsTab() {
  const container = document.getElementById('agents-selector-container');
  container.innerHTML = '';

  const agentNames = Object.keys(config.agents);
  if (agentNames.length === 0) {
    container.innerHTML = '<div class="text-muted p-3">No agents defined yet. Create one below!</div>';
    document.getElementById('agent-settings-card').style.display = 'none';
    document.getElementById('agent-settings-empty').style.display = 'block';
    return;
  }

  agentNames.forEach(name => {
    const btn = document.createElement('div');
    btn.className = `agent-item ${selectedAgentName === name ? 'selected' : ''}`;
    btn.textContent = name;
    btn.addEventListener('click', () => {
      selectedAgentName = name;
      renderAgentsTab();
      renderAgentSettings();
    });
    container.appendChild(btn);
  });
}

function renderAgentSettings() {
  if (!selectedAgentName || !config.agents[selectedAgentName]) {
    document.getElementById('agent-settings-card').style.display = 'none';
    document.getElementById('agent-settings-empty').style.display = 'block';
    return;
  }

  document.getElementById('agent-settings-card').style.display = 'block';
  document.getElementById('agent-settings-empty').style.display = 'none';
  document.getElementById('current-agent-title').textContent = `Agent Settings: ${selectedAgentName}`;

  // Populate fallback chain
  renderFallbackList();

  // Populate Add Step Provider dropdown
  const provSelect = document.getElementById('step-provider-select');
  provSelect.innerHTML = '<option value="" disabled selected>Select provider</option>';
  
  Object.keys(config.providers).forEach(provKey => {
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

function updateStepModelsDropdown() {
  const providerKey = document.getElementById('step-provider-select').value;
  const modelSelect = document.getElementById('step-model-select');
  modelSelect.innerHTML = '';

  const provider = config.providers[providerKey];
  if (!provider || !provider.models || provider.models.length === 0) {
    modelSelect.innerHTML = '<option value="" disabled selected>No models available</option>';
    modelSelect.disabled = true;
    return;
  }

  modelSelect.disabled = false;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.selected = true;
  placeholder.textContent = 'Select model...';
  modelSelect.appendChild(placeholder);

  provider.models.forEach(model => {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = model.name || model.id;
    modelSelect.appendChild(opt);
  });
}

function renderFallbackList() {
  const chainContainer = document.getElementById('fallback-chain-list');
  chainContainer.innerHTML = '';

  const fallbacks = config.agents[selectedAgentName].fallbacks || [];
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
  const fallbacks = config.agents[selectedAgentName].fallbacks;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= fallbacks.length) return;

  // Swap elements
  const temp = fallbacks[index];
  fallbacks[index] = fallbacks[targetIndex];
  fallbacks[targetIndex] = temp;

  renderAgentSettings();
}

function removeStep(index) {
  config.agents[selectedAgentName].fallbacks.splice(index, 1);
  renderAgentSettings();
}

function addFallbackStep() {
  const provider = document.getElementById('step-provider-select').value;
  const model = document.getElementById('step-model-select').value;

  if (!provider || !model) {
    alert("Please select both a provider and a model.");
    return;
  }

  if (!config.agents[selectedAgentName].fallbacks) {
    config.agents[selectedAgentName].fallbacks = [];
  }

  // Check if same pair already exists
  const exists = config.agents[selectedAgentName].fallbacks.some(s => s.provider === provider && s.model === model);
  if (exists) {
    alert("This provider/model pair is already in the fallback list.");
    return;
  }

  config.agents[selectedAgentName].fallbacks.push({
    provider: provider,
    model: model
  });

  // Reset dropdowns
  document.getElementById('step-provider-select').value = '';
  document.getElementById('step-model-select').innerHTML = '<option value="" disabled selected>Select model</option>';
  document.getElementById('step-model-select').disabled = true;

  renderAgentSettings();
}

function createAgent() {
  const input = document.getElementById('new-agent-name');
  const name = input.value.trim().toLowerCase();
  
  if (!name) return;
  if (config.agents[name]) {
    alert("An agent with this name already exists.");
    return;
  }

  config.agents[name] = {
    fallbacks: []
  };

  input.value = '';
  selectedAgentName = name;
  renderAgentsTab();
  renderAgentSettings();
  updateAgentsDropdown();
}

function renameSelectedAgent() {
  if (!selectedAgentName) return;
  const newName = prompt(`Enter new name for agent "${selectedAgentName}":`, selectedAgentName);
  if (!newName) return;
  const cleanedName = newName.trim().toLowerCase();
  if (cleanedName === selectedAgentName) return;
  
  if (config.agents[cleanedName]) {
    alert("An agent with this name already exists.");
    return;
  }

  config.agents[cleanedName] = config.agents[selectedAgentName];
  delete config.agents[selectedAgentName];

  selectedAgentName = cleanedName;
  renderAgentsTab();
  renderAgentSettings();
  updateAgentsDropdown();
}

function deleteSelectedAgent() {
  if (!selectedAgentName) return;
  if (!confirm(`Are you sure you want to delete the agent "${selectedAgentName}"?`)) return;

  delete config.agents[selectedAgentName];
  selectedAgentName = null;
  renderAgentsTab();
  updateAgentsDropdown();
}

async function saveAgentsConfig() {
  try {
    await fetchJSON('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ agents: config.agents })
    });
    alert('Agents configuration saved successfully!');
    loadConfig();
  } catch (e) {
    alert('Failed to save agents configuration: ' + e.message);
  }
}

// ─── TAB 3: API Keys Management Panel ────────────────────────────────────────

function renderKeysTab() {
  const container = document.getElementById('keys-manager-container');
  container.innerHTML = '';

  Object.keys(config.providers).forEach(provKey => {
    const provider = config.providers[provKey];
    
    const box = document.createElement('div');
    box.className = 'provider-keys-box';

    const title = document.createElement('h3');
    title.textContent = provider.name;
    box.appendChild(title);

    const list = document.createElement('div');
    list.className = 'keys-inputs-list';
    list.id = `keys-list-${provKey}`;
    box.appendChild(list);

    const keys = config.keys[provKey] || [];

    // Render existing keys
    keys.forEach((keyVal, idx) => {
      addKeyInputRow(provKey, keyVal, list);
    });

    // Add empty placeholder row if no keys
    if (keys.length === 0) {
      addKeyInputRow(provKey, '', list);
    }

    // Add Key Button
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-secondary btn-sm mt-3 align-self-start';
    addBtn.textContent = 'Add Key';
    addBtn.addEventListener('click', () => addKeyInputRow(provKey, '', list));
    box.appendChild(addBtn);

    container.appendChild(box);
  });
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
  const newKeys = {};

  Object.keys(config.providers).forEach(provKey => {
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
  // Populate Agent filter dropdown
  const agentSelect = document.getElementById('filter-agent');
  const originalVal = agentSelect.value;
  agentSelect.innerHTML = '<option value="">All Agents</option>';
  Object.keys(config.agents).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    agentSelect.appendChild(opt);
  });
  agentSelect.value = originalVal;

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
  const agent = document.getElementById('filter-agent').value;
  const provider = document.getElementById('filter-provider').value;
  const source = document.getElementById('filter-source').value;
  const status = document.getElementById('filter-status').value;

  const params = new URLSearchParams({
    page: logsPage,
    limit: logsLimit
  });
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  if (agent) params.append('agent', agent);
  if (provider) params.append('provider', provider);
  if (source) params.append('source', source);
  if (status) params.append('status', status);

  try {
    const data = await fetchJSON(`/api/usage?${params.toString()}`);
    
    // Fill metric summary numbers
    document.getElementById('stats-total-requests').textContent = data.totalCount;
    const rate = data.totalCount > 0 ? Math.round((data.successCount / data.totalCount) * 100) : 0;
    document.getElementById('stats-success-rate').textContent = `${rate}%`;
    document.getElementById('stats-avg-latency').textContent = `${data.avgLatency}ms`;

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
    tbody.innerHTML = '<tr><td colspan="10" class="text-muted" style="padding:1.5rem; text-align:center;">No request logs found matching current filters.</td></tr>';
    return;
  }

  logs.forEach(log => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--color-card-border)';

    const timeTd = document.createElement('td');
    timeTd.style.padding = '8px';
    timeTd.textContent = log.timestamp;

    const sourceTd = document.createElement('td');
    sourceTd.style.padding = '8px';
    const sourceSpan = document.createElement('span');
    sourceSpan.className = `badge ${log.source === 'Testing' ? 'badge-primary' : 'badge-secondary'}`;
    sourceSpan.textContent = log.source;
    sourceTd.appendChild(sourceSpan);

    const agentTd = document.createElement('td');
    agentTd.style.padding = '8px';
    agentTd.textContent = log.agent || '-';

    const provTd = document.createElement('td');
    provTd.style.padding = '8px';
    provTd.textContent = config.providers[log.provider]?.name || log.provider || '-';

    const modelTd = document.createElement('td');
    modelTd.style.padding = '8px';
    modelTd.style.fontFamily = 'var(--font-mono)';
    modelTd.style.fontSize = '0.75rem';
    modelTd.textContent = log.model ? log.model.split('/').pop() : '-';

    const keyTd = document.createElement('td');
    keyTd.style.padding = '8px';
    keyTd.textContent = log.key_name 
      ? `${log.key_name} (${log.key_email || 'No email'})` 
      : (log.key_index !== null ? `Key [${log.key_index}]` : '-');

    const proxyTd = document.createElement('td');
    proxyTd.style.padding = '8px';
    proxyTd.style.fontFamily = 'var(--font-mono)';
    proxyTd.style.fontSize = '0.75rem';
    proxyTd.textContent = log.proxy || '-';

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
    tr.appendChild(sourceTd);
    tr.appendChild(agentTd);
    tr.appendChild(provTd);
    tr.appendChild(modelTd);
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
  document.getElementById('modal-agent').textContent = log.agent || '-';
  document.getElementById('modal-prov-model').textContent = `${log.provider || '-'} / ${log.model || '-'}`;
  document.getElementById('modal-key').textContent = log.key_name 
    ? `${log.key_name} (${log.key_email || 'No email'})` 
    : (log.key_index !== null ? `Key [${log.key_index}]` : '-');
  document.getElementById('modal-proxy').textContent = log.proxy || 'direct';
  document.getElementById('modal-status').textContent = log.status;
  document.getElementById('modal-status').className = `info-val ${log.status === 'Success' ? 'text-success' : 'text-danger'}`;
  document.getElementById('modal-latency').textContent = log.latency_ms ? `${log.latency_ms}ms` : '-';

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

  const providerKeys = Object.keys(config.providers);
  if (providerKeys.length === 0) {
    container.innerHTML = '<div class="text-muted p-3">No providers defined. Create one below!</div>';
    document.getElementById('provider-settings-card').style.display = 'none';
    document.getElementById('provider-settings-empty').style.display = 'block';
    return;
  }

  providerKeys.forEach(key => {
    const btn = document.createElement('div');
    btn.className = `agent-item ${selectedProviderName === key ? 'selected' : ''}`;
    btn.textContent = config.providers[key].name || key;
    btn.addEventListener('click', () => {
      selectedProviderName = key;
      renderProvidersTab();
      renderProviderSettings();
    });
    container.appendChild(btn);
  });
}

function renderProviderSettings() {
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
  renderProviderModelsList();
}

function renderProviderModelsList() {
  const tbody = document.getElementById('provider-models-tbody');
  tbody.innerHTML = '';

  const provider = config.providers[selectedProviderName];
  const models = provider.models || [];

  if (models.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-muted" style="padding:1rem; text-align:center;">No models registered for this provider. Add one below!</td></tr>';
    return;
  }

  models.forEach((model, idx) => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--color-card-border)';

    const idTd = document.createElement('td');
    idTd.style.padding = '6px';
    idTd.style.fontFamily = 'var(--font-mono)';
    idTd.style.fontSize = '0.8rem';
    idTd.textContent = model.id;

    const aliasTd = document.createElement('td');
    aliasTd.style.padding = '6px';
    aliasTd.textContent = model.alias || '-';

    const nameTd = document.createElement('td');
    nameTd.style.padding = '6px';
    nameTd.textContent = model.name || '-';

    const contextTd = document.createElement('td');
    contextTd.style.padding = '6px';
    contextTd.style.textAlign = 'right';
    contextTd.textContent = model.contextWindow ? model.contextWindow.toLocaleString() : '-';

    const reasoningTd = document.createElement('td');
    reasoningTd.style.padding = '6px';
    reasoningTd.style.textAlign = 'center';
    reasoningTd.innerHTML = model.reasoning ? '<span class="text-success">Yes</span>' : '<span class="text-danger">No</span>';

    const codingTd = document.createElement('td');
    codingTd.style.padding = '6px';
    codingTd.style.textAlign = 'center';
    codingTd.innerHTML = model.coding ? '<span class="text-success">Yes</span>' : '<span class="text-danger">No</span>';

    const actionTd = document.createElement('td');
    actionTd.style.padding = '6px';
    actionTd.style.textAlign = 'right';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = 'Remove';
    delBtn.addEventListener('click', () => {
      provider.models.splice(idx, 1);
      renderProviderModelsList();
    });
    actionTd.appendChild(delBtn);

    tr.appendChild(idTd);
    tr.appendChild(aliasTd);
    tr.appendChild(nameTd);
    tr.appendChild(contextTd);
    tr.appendChild(reasoningTd);
    tr.appendChild(codingTd);
    tr.appendChild(actionTd);
    tbody.appendChild(tr);
  });
}

function addProviderModel() {
  const provider = config.providers[selectedProviderName];
  if (!provider) return;

  const id = document.getElementById('model-field-id').value.trim();
  const alias = document.getElementById('model-field-alias').value.trim();
  const name = document.getElementById('model-field-name').value.trim();
  const context = parseInt(document.getElementById('model-field-context').value);
  const reasoning = document.getElementById('model-field-reasoning').checked;
  const coding = document.getElementById('model-field-coding').checked;

  if (!id) {
    alert("Model ID is required.");
    return;
  }

  if (!provider.models) {
    provider.models = [];
  }

  // Check duplicate ID
  if (provider.models.some(m => m.id === id)) {
    alert("Model ID already registered.");
    return;
  }

  provider.models.push({
    id,
    alias: alias || id.split('/').pop(),
    name: name || id.split('/').pop(),
    contextWindow: isNaN(context) ? 128000 : context,
    reasoning,
    coding
  });

  // Reset inputs
  document.getElementById('model-field-id').value = '';
  document.getElementById('model-field-alias').value = '';
  document.getElementById('model-field-name').value = '';
  document.getElementById('model-field-context').value = '';

  renderProviderModelsList();
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
    statusVal.textContent = data.status;

    // Apply color class based on status
    if (data.status.includes('Active')) {
      statusVal.className = 'stat-val text-success';
    } else if (data.status.includes('Scraping') || data.status.includes('Testing')) {
      statusVal.className = 'stat-val text-warning';
    } else {
      statusVal.className = 'stat-val text-danger';
    }

    renderProxyTable(data.pool);
  } catch (err) {
    document.getElementById('proxy-pool-status').textContent = 'Error';
    document.getElementById('proxy-pool-status').className = 'stat-val text-danger';
  }
}

function renderProxyTable(pool) {
  const tbody = document.getElementById('proxy-pool-table-body');
  tbody.innerHTML = '';

  if (!pool || pool.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="text-muted" style="padding:1rem; text-align:center;">No active proxies. Direct connections will be used.</td></tr>';
    return;
  }

  pool.forEach(proxy => {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--color-card-border)';

    const urlTd = document.createElement('td');
    urlTd.style.padding = '6px 8px';
    urlTd.style.fontFamily = 'var(--font-mono)';
    urlTd.textContent = proxy.url;

    const speedTd = document.createElement('td');
    speedTd.style.padding = '6px 8px';
    speedTd.style.textAlign = 'right';
    
    // Format speed color based on latency
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
    tr.appendChild(urlTd);
    tr.appendChild(speedTd);
    tbody.appendChild(tr);
  });
}

async function triggerProxyRefresh() {
  const btn = document.getElementById('refresh-proxies-btn');
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  try {
    const res = await fetchJSON('/api/proxies/refresh', { method: 'POST' });
    if (res.success) {
      updateProxyStatus();
    }
  } catch (e) {
    console.error(e);
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = 'Refresh Proxies';
    }, 2000);
  }
}
