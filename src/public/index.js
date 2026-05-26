// Global State
let config = {
  providers: {},
  agents: {},
  keys: {},
  ips: []
};

let activeTab = 'tab-dashboard';
let selectedAgentName = null;
let healthTimer = null;
let uptimeTimer = null;
let startTime = Date.now();

// ─── Initializer ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
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

  // Start status polling
  startStatusPolling();
  startUptimeCounter();
  startProxyStatusPolling();
});

// ─── Tabs Navigation ─────────────────────────────────────────────────────────

function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const pane = document.getElementById(targetTab);
      pane.classList.add('active');
      
      activeTab = targetTab;
      
      // Refresh configurations when switching tabs
      if (activeTab === 'tab-agents') {
        renderAgentsTab();
      } else if (activeTab === 'tab-keys') {
        renderKeysTab();
      }
    });
  });
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

      keys.forEach((_, index) => {
        const dot = document.createElement('span');
        const state = states.find(s => s.keyIndex === index);
        
        dot.className = 'key-dot';
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
            timer.textContent = `Key [${index}] cooling down: ${cooldownLeft}s left`;
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
      const dot = document.createElement('div');
      dot.className = 'keys-dots';
      const d = document.createElement('span');
      d.className = 'key-dot inactive';
      dot.appendChild(d);
      row.appendChild(dot);
    }

    container.appendChild(row);
  });
}



// ─── API Tester Panel ────────────────────────────────────────────────────────

function updateAgentsDropdown() {
  const select = document.getElementById('test-agent-select');
  const warning = document.getElementById('agent-warning');
  const runBtn = document.getElementById('run-test-btn');
  
  select.innerHTML = '';
  const agents = Object.keys(config.agents || {});
  
  document.getElementById('server-agents-count').textContent = agents.length;

  if (agents.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = 'No agents configured';
    select.appendChild(opt);
    
    warning.style.display = 'block';
    runBtn.disabled = true;
    return;
  }

  warning.style.display = 'none';
  runBtn.disabled = false;

  agents.forEach(agent => {
    const opt = document.createElement('option');
    opt.value = agent;
    opt.textContent = agent.charAt(0).toUpperCase() + agent.slice(1);
    select.appendChild(opt);
  });
}

async function runApiTest(e) {
  e.preventDefault();
  const agent = document.getElementById('test-agent-select').value;
  const prompt = document.getElementById('test-prompt').value;
  const stream = document.getElementById('test-stream').checked;
  const outputBox = document.getElementById('json-response-output');
  const runBtn = document.getElementById('run-test-btn');

  if (!agent) {
    alert("Please select an agent to test.");
    return;
  }

  outputBox.textContent = 'Querying Aurora-Provider... Please wait.\n';
  runBtn.disabled = true;

  try {
    const startTime = Date.now();
    const payload = {
      model: `aurora-provider/${agent}`,
      messages: [{ role: 'user', content: prompt }],
      stream: stream
    };

    const response = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer aurora-provider-local'
      },
      body: JSON.stringify(payload)
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      outputBox.textContent = `HTTP Error ${response.status}\n\n${JSON.stringify(errData, null, 2)}`;
      return;
    }

    if (stream) {
      outputBox.textContent = `[Streaming response started - elapsed: ${elapsed}s]\n\n`;
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        outputBox.textContent += chunk;
      }
      outputBox.textContent += `\n\n[Streaming complete]`;
    } else {
      const data = await response.json();
      const fullResponse = {
        meta: {
          endpoint: '/v1/chat/completions',
          agent: agent,
          provider_used: response.headers.get('X-Aurora-Provider'),
          execution_time_seconds: parseFloat(elapsed)
        },
        response: data
      };
      outputBox.textContent = JSON.stringify(fullResponse, null, 2);
    }
  } catch (err) {
    outputBox.textContent = `Network Error:\n${err.message}`;
  } finally {
    runBtn.disabled = false;
  }
}

// ─── TAB 2: Agents Config Panel ──────────────────────────────────────────────

function renderUIPool() {
  // Update provider/model selection drop-downs for new steps
  const providerSelect = document.getElementById('step-provider-select');
  providerSelect.innerHTML = '<option value="" disabled selected>Select provider</option>';
  
  Object.keys(config.providers).forEach(provKey => {
    const opt = document.createElement('option');
    opt.value = provKey;
    opt.textContent = config.providers[provKey].name;
    providerSelect.appendChild(opt);
  });
}

function updateStepModelsDropdown() {
  const providerSelect = document.getElementById('step-provider-select');
  const modelSelect = document.getElementById('step-model-select');
  const providerKey = providerSelect.value;

  modelSelect.innerHTML = '<option value="" disabled selected>Select model</option>';
  
  if (!providerKey || !config.providers[providerKey]) {
    modelSelect.disabled = true;
    return;
  }

  const models = config.providers[providerKey].models || [];
  models.forEach(model => {
    const opt = document.createElement('option');
    opt.value = model.id;
    opt.textContent = `${model.name} (${model.id})`;
    modelSelect.appendChild(opt);
  });

  modelSelect.disabled = false;
}

function renderAgentsTab() {
  const container = document.getElementById('agents-selector-container');
  container.innerHTML = '';

  const agents = Object.keys(config.agents || {});
  
  if (agents.length === 0) {
    container.innerHTML = '<div class="text-muted" style="padding:1rem;">No agents configured yet.</div>';
    document.getElementById('agent-settings-card').style.display = 'none';
    document.getElementById('agent-settings-empty').style.display = 'block';
    selectedAgentName = null;
    return;
  }

  agents.forEach(agentName => {
    const item = document.createElement('div');
    item.className = `agent-item ${agentName === selectedAgentName ? 'selected' : ''}`;
    
    const name = document.createElement('span');
    name.textContent = agentName;

    const count = document.createElement('span');
    count.className = 'agent-item-count';
    count.textContent = `${(config.agents[agentName].fallbacks || []).length} steps`;

    item.appendChild(name);
    item.appendChild(count);
    
    item.addEventListener('click', () => {
      selectedAgentName = agentName;
      renderAgentsTab();
      renderAgentSettings();
    });

    container.appendChild(item);
  });

  if (selectedAgentName && config.agents[selectedAgentName]) {
    document.getElementById('agent-settings-card').style.display = 'block';
    document.getElementById('agent-settings-empty').style.display = 'none';
  } else {
    document.getElementById('agent-settings-card').style.display = 'none';
    document.getElementById('agent-settings-empty').style.display = 'block';
  }
}

function renderAgentSettings() {
  if (!selectedAgentName || !config.agents[selectedAgentName]) return;

  const agent = config.agents[selectedAgentName];
  document.getElementById('current-agent-title').textContent = `Agent Settings: ${selectedAgentName}`;

  const chainContainer = document.getElementById('fallback-chain-list');
  chainContainer.innerHTML = '';

  const fallbacks = agent.fallbacks || [];
  
  if (fallbacks.length === 0) {
    chainContainer.innerHTML = '<div class="text-muted" style="padding:1rem; border:1px dashed var(--color-card-border); text-align:center; border-radius: var(--border-radius-md);">No fallback steps added yet. Add your first step below.</div>';
    return;
  }

  fallbacks.forEach((step, idx) => {
    const item = document.createElement('div');
    item.className = 'fallback-step-item';

    const prio = document.createElement('span');
    prio.className = 'step-priority-number';
    prio.textContent = `Prio ${idx + 1}`;

    const details = document.createElement('div');
    details.className = 'step-details';

    const pName = document.createElement('span');
    pName.className = 'step-provider';
    pName.textContent = config.providers[step.provider]?.name || step.provider;

    const mName = document.createElement('span');
    mName.className = 'step-model';
    mName.textContent = step.model;

    details.appendChild(pName);
    details.appendChild(mName);

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
    keys.forEach((key, idx) => {
      addKeyInputRow(provKey, key, list);
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

  if (providerKey === 'cloudflare_workers_ai') {
    // Cloudflare has special object key structure (apiToken, accountId)
    const fields = document.createElement('div');
    fields.className = 'cf-key-fields';

    const tokenInput = document.createElement('input');
    tokenInput.type = 'text';
    tokenInput.className = 'form-input cf-token';
    tokenInput.placeholder = 'API Token';
    tokenInput.value = (typeof keyValue === 'object') ? keyValue.apiToken : '';

    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.className = 'form-input cf-account-id';
    idInput.placeholder = 'Account ID';
    idInput.value = (typeof keyValue === 'object') ? keyValue.accountId : '';

    fields.appendChild(tokenInput);
    fields.appendChild(idInput);
    row.appendChild(fields);
  } else {
    // Standard string key input
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input standard-key';
    input.placeholder = 'Paste API Key';
    input.value = keyValue || '';
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

    if (provKey === 'cloudflare_workers_ai') {
      const rows = list.querySelectorAll('.key-input-row');
      rows.forEach(row => {
        const token = row.querySelector('.cf-token').value.trim();
        const accountId = row.querySelector('.cf-account-id').value.trim();
        if (token && accountId) {
          newKeys[provKey].push({ apiToken: token, accountId: accountId });
        }
      });
    } else {
      const inputs = list.querySelectorAll('.standard-key');
      inputs.forEach(input => {
        const val = input.value.trim();
        if (val) {
          newKeys[provKey].push(val);
        }
      });
    }
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
