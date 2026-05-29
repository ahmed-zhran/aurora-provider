document.addEventListener('DOMContentLoaded', () => {

  // ─── 1. Quickstart Tab Switcher ───────────────────────────────────────────
  const tabs = document.querySelectorAll('.selector-tab');
  const panes = document.querySelectorAll('.code-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all tabs & panes
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      // Add active to current
      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');
    });
  });

  // ─── 2. Interactive Fallback Visualizer ────────────────────────────────────
  const auraSelect = document.getElementById('viz-aura-select');
  const sendBtn = document.getElementById('viz-send-btn');
  const chainContainer = document.getElementById('chain-nodes-container');
  const consoleBody = document.getElementById('viz-console-body');
  
  // Elements for status
  const statRoute = document.getElementById('viz-stat-route');
  const statLatency = document.getElementById('viz-stat-latency');
  const shieldOverlay = document.getElementById('proxy-shield-overlay');
  const shieldIp = document.getElementById('shield-ip');

  // Node Elements
  const clientNode = document.getElementById('node-client');
  const routerNode = document.getElementById('node-router');

  // Simulated Proxy IPs
  const PROXIES = [
    '45.8.98.142:30010',
    '185.220.101.5:8080',
    '78.47.16.122:1080',
    '198.23.250.28:1085',
    '95.216.147.202:9050'
  ];

  // Visualizer configs
  const AURA_CONFIGS = {
    coder: [
      { id: 'v-node-1', provider: 'OpenAI', model: 'gpt-4o', key: 'Key [0]', status: 'Rate Limited (HTTP 429)', type: 'error' },
      { id: 'v-node-2', provider: 'OpenAI (Rotated)', model: 'gpt-4o', key: 'Key [1]', status: 'Rate Limited (HTTP 429)', type: 'error' },
      { id: 'v-node-3', provider: 'Anthropic (Fallback)', model: 'claude-3-5-sonnet', key: 'Key [0]', status: 'Success (Masked)', type: 'success', latency: '420ms', response: '// Go fast Fibonacci\nfunc Fib(n int) int {\n  if n <= 1 { return n }\n  a, b := 0, 1\n  for i := 2; i <= n; i++ {\n    a, b = b, a+b\n  }\n  return b\n}' }
    ],
    writer: [
      { id: 'v-node-1', provider: 'Gemini', model: 'gemini-1.5-pro', key: 'Key [0]', status: 'Expired Key (HTTP 401)', type: 'error' },
      { id: 'v-node-2', provider: 'OpenAI (Fallback)', model: 'gpt-4o', key: 'Key [0]', status: 'Success (Masked)', type: 'success', latency: '580ms', response: 'The neon sky over Cairo bled purple as the Aurora Router initialized. "We are online," the console blinked. Ahmed typed rapidly, watching the packets flow...' }
    ]
  };

  // Render nodes for active option
  function renderAuraNodes() {
    const selected = auraSelect.value;
    const steps = AURA_CONFIGS[selected];
    chainContainer.innerHTML = '';

    steps.forEach((step, idx) => {
      const stepDiv = document.createElement('div');
      stepDiv.className = 'chain-node';
      stepDiv.id = step.id;
      
      const badge = document.createElement('span');
      badge.className = 'chain-badge';
      badge.textContent = `STEP ${idx + 1}: ${step.provider}`;
      
      const name = document.createElement('span');
      name.textContent = step.model;
      
      stepDiv.appendChild(badge);
      stepDiv.appendChild(name);
      chainContainer.appendChild(stepDiv);
    });
  }

  // Monitor select box change
  auraSelect.addEventListener('change', renderAuraNodes);
  renderAuraNodes(); // Initial run

  // Logging helpers
  function clearConsole() {
    consoleBody.innerHTML = '';
  }

  function addConsoleLine(text, className = '') {
    const line = document.createElement('div');
    line.className = `console-line ${className}`;
    line.textContent = `> ${text}`;
    consoleBody.appendChild(line);
    consoleBody.scrollTop = consoleBody.scrollHeight;
  }

  async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Animation timeline
  let isRunning = false;
  sendBtn.addEventListener('click', async () => {
    if (isRunning) return;
    isRunning = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Running Trace...';

    const selected = auraSelect.value;
    const steps = AURA_CONFIGS[selected];
    const proxyIp = PROXIES[Math.floor(Math.random() * PROXIES.length)];

    // Reset UI
    clearConsole();
    shieldOverlay.classList.remove('active');
    statRoute.textContent = '-';
    statLatency.textContent = '-';
    clientNode.className = 'node node-client active';
    routerNode.className = 'node node-router';
    routerNode.querySelector('.node-status').textContent = 'Idle';
    document.querySelectorAll('.chain-node').forEach(node => {
      node.className = 'chain-node';
    });

    // 1. Client sends request
    addConsoleLine('Incoming request to /v1/chat/completions', 'text-success');
    clientNode.className = 'node node-client success';
    await sleep(600);

    // 2. Coder Aura picks up request
    addConsoleLine(`Model header: "aurora-provider/${selected}". Resolving Aura fallback chain...`);
    routerNode.className = 'node node-router loading';
    routerNode.querySelector('.node-status').textContent = 'Routing...';
    await sleep(800);

    let successfulStep = null;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const nodeEl = document.getElementById(step.id);
      
      addConsoleLine(`[Attempt ${i+1}] Routing via ${step.provider} / ${step.model} using key: ${step.key}...`);
      nodeEl.className = 'chain-node loading';
      await sleep(1000);

      if (step.type === 'error') {
        nodeEl.className = 'chain-node failed';
        addConsoleLine(`[Attempt ${i+1}] Provider returned error: ${step.status}`, 'text-danger');
        addConsoleLine(`Rotating API key/provider fallback chain...`, 'text-warning');
        await sleep(800);
      } else {
        // SOCKS5 IP Masking Shield triggers
        addConsoleLine(`[Proxy Masking] Bypassing IP-based rate limits. Shielding outbound SOCKS5 route...`, 'text-cyan');
        shieldIp.textContent = proxyIp;
        shieldOverlay.classList.add('active');
        await sleep(1200);

        shieldOverlay.classList.remove('active');
        nodeEl.className = 'chain-node success';
        routerNode.className = 'node node-router success';
        routerNode.querySelector('.node-status').textContent = 'Completed';
        addConsoleLine(`[Attempt ${i+1}] Successful connection established via SOCKS5 proxy: ${proxyIp}`, 'text-success');
        successfulStep = step;
        break;
      }
    }
    
    if (successfulStep) {
      // Type response out
      addConsoleLine('Streaming response payload:', 'text-success');
      const responseText = successfulStep.response;
      const responseDiv = document.createElement('div');
      responseDiv.className = 'console-line text-success font-mono mt-2';
      responseDiv.style.whiteSpace = 'pre-wrap';
      responseDiv.style.borderLeft = '2px solid var(--color-success)';
      responseDiv.style.paddingLeft = '0.75rem';
      consoleBody.appendChild(responseDiv);

      // Simulate typing stream
      let curIndex = 0;
      const typeSpeed = selected === 'coder' ? 10 : 25;
      while (curIndex < responseText.length) {
        responseDiv.textContent += responseText[curIndex];
        curIndex++;
        consoleBody.scrollTop = consoleBody.scrollHeight;
        await sleep(typeSpeed);
      }
      
      // Update stats
      statRoute.textContent = `${successfulStep.provider} (via Proxy)`;
      statLatency.textContent = successfulStep.latency;
    }

    addConsoleLine(`Trace completed. Cleaned up connection socket. Status: 200 OK`, 'text-muted');

    isRunning = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send Request';
  });

  // ─── 3. Aura Config Builder ──────────────────────────────────────────────
  const auraNameInput = document.getElementById('builder-aura-name');
  const stepsList = document.getElementById('fallback-steps-list');
  const addStepBtn = document.getElementById('builder-add-step-btn');
  const saveBtn = document.getElementById('builder-save-btn');
  const copyBtn = document.getElementById('builder-copy-btn');
  const codePreview = document.getElementById('builder-code-preview');

  // Available options
  const PROVIDER_OPTIONS = [
    { value: 'openai', name: 'OpenAI' },
    { value: 'anthropic', name: 'Anthropic' },
    { value: 'gemini', name: 'Google Gemini' },
    { value: 'groq', name: 'Groq' },
    { value: 'openrouter', name: 'OpenRouter' },
    { value: 'cloudflare_workers_ai', name: 'Cloudflare AI' }
  ];

  // Default steps
  let builderSteps = [
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'anthropic', model: 'claude-3-5-sonnet' }
  ];

  function renderBuilderSteps() {
    stepsList.innerHTML = '';
    
    builderSteps.forEach((step, index) => {
      const stepDiv = document.createElement('div');
      stepDiv.className = 'fallback-step-item';
      
      const numSpan = document.createElement('span');
      numSpan.className = 'step-num';
      numSpan.textContent = index + 1;
      
      // Select provider
      const providerSelect = document.createElement('select');
      PROVIDER_OPTIONS.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.name;
        if (opt.value === step.provider) o.selected = true;
        providerSelect.appendChild(o);
      });
      
      providerSelect.addEventListener('change', (e) => {
        builderSteps[index].provider = e.target.value;
        // Suggest default model
        if (e.target.value === 'openai') builderSteps[index].model = 'gpt-4o';
        else if (e.target.value === 'anthropic') builderSteps[index].model = 'claude-3-5-sonnet';
        else if (e.target.value === 'gemini') builderSteps[index].model = 'gemini-1.5-pro';
        else if (e.target.value === 'groq') builderSteps[index].model = 'llama3-70b';
        else if (e.target.value === 'cloudflare_workers_ai') builderSteps[index].model = '@cf/meta/llama-3-8b';
        else builderSteps[index].model = 'model-id';
        
        renderBuilderSteps();
        updateConfigPreview();
      });

      // Model input
      const modelInput = document.createElement('input');
      modelInput.type = 'text';
      modelInput.value = step.model;
      modelInput.placeholder = 'model-id';
      modelInput.addEventListener('input', (e) => {
        builderSteps[index].model = e.target.value;
        updateConfigPreview();
      });

      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove-step';
      removeBtn.innerHTML = '×';
      removeBtn.title = 'Remove fallback step';
      removeBtn.addEventListener('click', () => {
        if (builderSteps.length <= 1) {
          alert('You must have at least one fallback step in your chain!');
          return;
        }
        builderSteps.splice(index, 1);
        renderBuilderSteps();
        updateConfigPreview();
      });

      stepDiv.appendChild(numSpan);
      stepDiv.appendChild(providerSelect);
      stepDiv.appendChild(modelInput);
      stepDiv.appendChild(removeBtn);
      stepsList.appendChild(stepDiv);
    });

    updateConfigPreview();
  }

  // Update real-time preview
  function updateConfigPreview() {
    const auraName = auraNameInput.value.trim().toLowerCase() || 'scribe';
    const config = {
      auras: {
        [auraName]: {
          fallbacks: builderSteps.map(step => ({
            provider: step.provider,
            model: step.model
          }))
        }
      }
    };
    codePreview.textContent = JSON.stringify(config, null, 2);
  }

  // Monitor name change
  auraNameInput.addEventListener('input', updateConfigPreview);

  // Add step button
  addStepBtn.addEventListener('click', () => {
    builderSteps.push({ provider: 'openai', model: 'gpt-4o' });
    renderBuilderSteps();
  });

  // Copy to clipboard
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(codePreview.textContent)
      .then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        copyBtn.style.background = 'var(--color-primary-glow)';
        copyBtn.style.color = 'var(--color-primary)';
        setTimeout(() => {
          copyBtn.textContent = originalText;
          copyBtn.style.background = '';
          copyBtn.style.color = '';
        }, 1500);
      })
      .catch(err => {
        alert('Failed to copy config: ' + err.message);
      });
  });

  // Save config / download auras.json
  saveBtn.addEventListener('click', () => {
    const auraName = auraNameInput.value.trim().toLowerCase() || 'scribe';
    const configContent = codePreview.textContent;
    
    const blob = new Blob([configContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${auraName}_aura.json`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Init builder
  renderBuilderSteps();

  // ─── 4. Typing Effect for Hero Title ──────────────────────────────────────
  const phrases = [
    "Empower your apps with Auras now",
    "Aura Hub: a centralized place to chain providers",
    "Tired of provider & model hell? Switch to Aura",
    "One Aura to support them all—no provider jumps",
    "Aura is the future of model rotation & fallbacks"
  ];
  let phraseIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  const typedTextSpan = document.getElementById("typed-text");

  function typeEffect() {
    if (!typedTextSpan) return;
    const currentPhrase = phrases[phraseIndex];
    if (isDeleting) {
      typedTextSpan.textContent = currentPhrase.substring(0, charIndex - 1);
      charIndex--;
    } else {
      typedTextSpan.textContent = currentPhrase.substring(0, charIndex + 1);
      charIndex++;
    }

    let delay = isDeleting ? 30 : 60;

    if (!isDeleting && charIndex === currentPhrase.length) {
      delay = 2000; // Pause at full phrase
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      phraseIndex = (phraseIndex + 1) % phrases.length;
      delay = 500; // Pause before typing next phrase
    }

    setTimeout(typeEffect, delay);
  }
  
  if (typedTextSpan) {
    typeEffect();
  }

});
