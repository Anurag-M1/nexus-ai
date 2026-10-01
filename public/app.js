// ==========================================
// NexusAI — Frontend Application
// Communicates with Express backend API
// ==========================================

// ===================== API CLIENT =====================
const API = {
  async get(endpoint) {
    const res = await fetch(`/api${endpoint}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  },

  async post(endpoint, data) {
    const res = await fetch(`/api${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  },

  async del(endpoint) {
    const res = await fetch(`/api${endpoint}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  },
};

// ===================== LOCAL STATE =====================
let chatHistory = [];

// ===================== NAVIGATION =====================
function initNavigation() {
  document.querySelectorAll('.nav-link[data-page]').forEach(link => {
    link.addEventListener('click', () => navigateTo(link.dataset.page));
  });
}

function navigateTo(page) {
  document.querySelectorAll('.nav-link[data-page]').forEach(l => l.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if (el) {
    el.classList.add('active');
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = '';
  }

  if (page === 'graph') setTimeout(loadGraph, 100);
  if (page === 'dashboard') loadDashboard();
  if (page === 'sources') loadSources();
  if (page === 'reports') loadReports();
  if (page === 'chat') loadChatHistory();
}

// ===================== SETTINGS =====================
function initSettings() {
  document.getElementById('settings-btn')?.addEventListener('click', () => {
    document.getElementById('settings-modal').style.display = 'flex';
  });
  document.getElementById('close-settings')?.addEventListener('click', () => {
    document.getElementById('settings-modal').style.display = 'none';
  });
  document.getElementById('settings-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') document.getElementById('settings-modal').style.display = 'none';
  });
  document.getElementById('save-settings')?.addEventListener('click', saveSettings);
  document.getElementById('btn-settings-seed')?.addEventListener('click', loadSampleData);
  document.getElementById('btn-settings-reset')?.addEventListener('click', resetDatabase);

  // Load settings
  loadSettings();
}

async function loadSettings() {
  try {
    const settings = await API.get('/settings');
    if (settings.apiKey) document.getElementById('api-key-input').value = settings.apiKey;
    if (settings.model) document.getElementById('model-select').value = settings.model;
    updateApiStatus(!!settings.apiKey);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function saveSettings() {
  try {
    const apiKey = document.getElementById('api-key-input').value.trim();
    const model = document.getElementById('model-select').value;
    await API.post('/settings', { apiKey, model });
    updateApiStatus(!!apiKey);
    document.getElementById('settings-modal').style.display = 'none';
    showToast('Settings saved!', 'success');
  } catch (err) {
    showToast(`Failed to save: ${err.message}`, 'error');
  }
}

function updateApiStatus(connected) {
  const el = document.getElementById('api-status');
  if (connected) {
    el.classList.add('connected');
    el.querySelector('span').textContent = 'API Connected';
  } else {
    el.classList.remove('connected');
    el.querySelector('span').textContent = 'API Not Set';
  }
}

// ===================== SOURCES =====================
function initSources() {
  ['btn-add-source', 'btn-add-source-quick', 'btn-first-source'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      navigateTo('sources');
      toggleSourcePanel(true);
    });
  });

  document.getElementById('btn-close-source-panel')?.addEventListener('click', () => toggleSourcePanel(false));
  document.getElementById('btn-view-all-sources')?.addEventListener('click', () => navigateTo('sources'));

  // Input tabs
  document.querySelectorAll('.input-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const type = tab.dataset.inputType;
      document.getElementById('input-text-area').style.display = type === 'text' ? 'block' : 'none';
      document.getElementById('input-url-area').style.display = type === 'url' ? 'block' : 'none';
    });
  });

  // URL fetch
  document.getElementById('btn-fetch-url')?.addEventListener('click', fetchUrlContent);

  // Process
  document.getElementById('btn-process-source')?.addEventListener('click', processSource);
}

function toggleSourcePanel(show) {
  const panel = document.getElementById('source-input-panel');
  if (panel) {
    panel.style.display = show ? 'block' : 'none';
    if (show) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function fetchUrlContent() {
  const url = document.getElementById('source-url').value.trim();
  if (!url) { showToast('Enter a URL first.', 'warning'); return; }

  const btn = document.getElementById('btn-fetch-url');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;"></div> Fetching...';

  try {
    const result = await API.post('/scrape', { url });
    const contentArea = document.getElementById('source-url-content');
    contentArea.value = result.content;
    contentArea.style.display = 'block';
    if (!document.getElementById('source-url-title').value) {
      const titleMatch = result.content.match(/^Title: (.+)$/m);
      if (titleMatch) document.getElementById('source-url-title').value = titleMatch[1];
    }
    showToast('Content fetched!', 'success');
  } catch (err) {
    showToast(`Failed to fetch: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="download"></i> Fetch Content';
    if (window.lucide) lucide.createIcons();
  }
}

async function processSource() {
  const activeTab = document.querySelector('.input-tab.active')?.dataset.inputType || 'text';
  let title, content, type;

  if (activeTab === 'text') {
    title = document.getElementById('source-title').value.trim();
    content = document.getElementById('source-text').value.trim();
    type = 'text';
  } else {
    title = document.getElementById('source-url-title').value.trim();
    content = document.getElementById('source-url-content').value.trim();
    type = 'url';
    if (!content) {
      // Try fetching first
      await fetchUrlContent();
      content = document.getElementById('source-url-content').value.trim();
    }
  }

  if (!title) { showToast('Please enter a source title.', 'warning'); return; }
  if (!content || content.length < 20) { showToast('Content must be at least 20 characters.', 'warning'); return; }

  const processBtn = document.getElementById('btn-process-source');
  const indicator = document.getElementById('processing-indicator');
  processBtn.style.display = 'none';
  indicator.style.display = 'flex';

  try {
    const result = await API.post('/analyze', { title, content, type });
    
    // Clear form
    document.getElementById('source-title').value = '';
    document.getElementById('source-text').value = '';
    document.getElementById('source-url-title').value = '';
    document.getElementById('source-url').value = '';
    document.getElementById('source-url-content').value = '';
    document.getElementById('source-url-content').style.display = 'none';
    toggleSourcePanel(false);

    showToast(`"${title}" analyzed! Found ${result.entityCount} entities and ${result.connectionCount} connections.`, 'success');
    loadSources();
    loadDashboard();
  } catch (err) {
    showToast(`Analysis failed: ${err.message}`, 'error');
  } finally {
    processBtn.style.display = 'inline-flex';
    indicator.style.display = 'none';
  }
}

async function loadSources() {
  try {
    const sources = await API.get('/sources');
    const grid = document.getElementById('sources-grid');
    const empty = document.getElementById('sources-empty');

    if (sources.length === 0) {
      grid.innerHTML = '';
      grid.appendChild(empty);
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    grid.innerHTML = sources.map(s => `
      <div class="source-card" data-source-id="${s.id}">
        <div class="source-card-actions">
          <button class="btn btn-danger btn-sm btn-icon delete-source" data-id="${s.id}" title="Delete">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
        <div class="source-card-header">
          <span class="source-card-title">${esc(s.title)}</span>
          <span class="source-card-type ${s.type}">${s.type}</span>
        </div>
        <p class="source-card-preview">${esc(s.summary || s.content?.substring(0, 200) || '')}</p>
        <div class="source-card-meta">
          <div class="source-card-entities">
            <span class="entity-chip" style="background:rgba(99,102,241,0.15);color:#818cf8;">${s.entity_count} entities</span>
          </div>
          <span class="source-card-date">${fmtDate(s.created_at)}</span>
        </div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
    grid.querySelectorAll('.delete-source').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await API.del(`/sources/${btn.dataset.id}`);
          showToast('Source deleted.', 'info');
          loadSources();
          loadDashboard();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  } catch (err) {
    console.error('Failed to load sources:', err);
  }
}

// ===================== KNOWLEDGE GRAPH =====================
async function loadGraph() {
  try {
    const { nodes, links } = await API.get('/graph');
    renderGraph(nodes, links);
  } catch (err) {
    console.error('Failed to load graph:', err);
  }
}

function renderGraph(nodes, links) {
  const container = document.getElementById('graph-container');
  const svg = document.getElementById('knowledge-graph');
  const emptyState = document.getElementById('graph-empty');
  const legendItems = document.getElementById('legend-items');

  if (!nodes || nodes.length === 0) {
    emptyState.style.display = 'flex';
    svg.innerHTML = '';
    legendItems.innerHTML = '';
    return;
  }

  emptyState.style.display = 'none';
  svg.innerHTML = '';

  const width = container.clientWidth;
  const height = container.clientHeight;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  // Map node ids
  const nodeMap = {};
  nodes.forEach((n, i) => { nodeMap[n.id] = i; n.idx = i; });

  // Position nodes
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const radius = Math.min(width, height) * 0.3;
    n.x = width / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 60;
    n.y = height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 60;
    n.radius = 8 + Math.min((n.count || 1), 6) * 3;
    n.vx = 0;
    n.vy = 0;
  });

  // Resolve links to indices
  const resolvedLinks = [];
  links.forEach(l => {
    const si = nodeMap[l.source];
    const ti = nodeMap[l.target];
    if (si !== undefined && ti !== undefined) {
      resolvedLinks.push({ source: si, target: ti, relationship: l.relationship });
    }
  });

  // SVG Defs
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filter.setAttribute('id', 'glow');
  filter.innerHTML = '<feGaussianBlur stdDeviation="3" result="cb"/><feMerge><feMergeNode in="cb"/><feMergeNode in="SourceGraphic"/></feMerge>';
  defs.appendChild(filter);
  svg.appendChild(defs);

  // Links
  const linksG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  linksG.setAttribute('class', 'links');
  const linkEls = resolvedLinks.map(l => {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('class', 'graph-link');
    linksG.appendChild(line);
    return { el: line, data: l };
  });
  svg.appendChild(linksG);

  // Nodes
  const nodesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  nodesG.setAttribute('class', 'nodes');
  const nodeEls = nodes.map(n => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'graph-node');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', n.radius);
    circle.setAttribute('fill', entityColor(n.type));
    circle.setAttribute('filter', 'url(#glow)');
    g.appendChild(circle);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('dy', n.radius + 16);
    text.textContent = n.name.length > 20 ? n.name.substring(0, 18) + '…' : n.name;
    g.appendChild(text);

    g.addEventListener('click', () => showNodeDetails(n, resolvedLinks, nodes));
    g.addEventListener('mouseenter', () => {
      g.classList.add('selected');
      linkEls.forEach(le => {
        if (le.data.source === n.idx || le.data.target === n.idx) le.el.classList.add('highlighted');
      });
    });
    g.addEventListener('mouseleave', () => {
      g.classList.remove('selected');
      linkEls.forEach(le => le.el.classList.remove('highlighted'));
    });

    nodesG.appendChild(g);
    return { el: g, data: n };
  });
  svg.appendChild(nodesG);

  // Force simulation
  let alpha = 1;
  let dragNode = null;

  function tick() {
    if (alpha < 0.001) return;
    alpha *= 0.99;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = 1000 / (dist * dist);
        const fx = (dx / dist) * f * alpha;
        const fy = (dy / dist) * f * alpha;
        nodes[j].x += fx; nodes[j].y += fy;
        nodes[i].x -= fx; nodes[i].y -= fy;
      }
    }

    resolvedLinks.forEach(l => {
      const s = nodes[l.source], t = nodes[l.target];
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const f = (dist - 130) * 0.015 * alpha;
      const fx = (dx / dist) * f, fy = (dy / dist) * f;
      s.x += fx; s.y += fy; t.x -= fx; t.y -= fy;
    });

    nodes.forEach(n => {
      n.x += (width / 2 - n.x) * 0.008 * alpha;
      n.y += (height / 2 - n.y) * 0.008 * alpha;
      n.x = Math.max(50, Math.min(width - 50, n.x));
      n.y = Math.max(50, Math.min(height - 50, n.y));
    });

    nodeEls.forEach(ne => ne.el.setAttribute('transform', `translate(${ne.data.x},${ne.data.y})`));
    linkEls.forEach(le => {
      const s = nodes[le.data.source], t = nodes[le.data.target];
      le.el.setAttribute('x1', s.x); le.el.setAttribute('y1', s.y);
      le.el.setAttribute('x2', t.x); le.el.setAttribute('y2', t.y);
    });

    requestAnimationFrame(tick);
  }
  tick();

  // Drag
  svg.addEventListener('mousedown', e => {
    const target = e.target.closest('.graph-node');
    if (target) {
      const idx = [...target.parentNode.children].indexOf(target);
      dragNode = nodes[idx];
      alpha = 0.3;
    }
  });
  svg.addEventListener('mousemove', e => {
    if (dragNode) {
      const rect = svg.getBoundingClientRect();
      dragNode.x = (e.clientX - rect.left) * (width / rect.width);
      dragNode.y = (e.clientY - rect.top) * (height / rect.height);
    }
  });
  svg.addEventListener('mouseup', () => { dragNode = null; });
  svg.addEventListener('mouseleave', () => { dragNode = null; });

  // Zoom controls
  let scale = 1, tx = 0, ty = 0;
  function applyZoom() {
    [linksG, nodesG].forEach(g => g.setAttribute('transform', `translate(${tx},${ty}) scale(${scale})`));
  }
  document.getElementById('graph-zoom-in')?.addEventListener('click', () => { scale = Math.min(scale * 1.25, 3); applyZoom(); });
  document.getElementById('graph-zoom-out')?.addEventListener('click', () => { scale = Math.max(scale / 1.25, 0.3); applyZoom(); });
  document.getElementById('graph-reset')?.addEventListener('click', () => { scale = 1; tx = 0; ty = 0; applyZoom(); });

  // Legend
  const types = [...new Set(nodes.map(n => n.type))];
  legendItems.innerHTML = types.map(t => `
    <div class="legend-item">
      <div class="legend-dot" style="background:${entityColor(t)};"></div>
      <span>${t.charAt(0).toUpperCase() + t.slice(1)}</span>
    </div>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function showNodeDetails(node, links, nodes) {
  document.getElementById('node-detail-name').textContent = node.name;
  const typeEl = document.getElementById('node-detail-type');
  typeEl.textContent = node.type;
  typeEl.style.background = `${entityColor(node.type)}22`;
  typeEl.style.color = entityColor(node.type);
  document.getElementById('node-detail-desc').textContent = node.description || 'No description available.';

  const related = links.filter(l => l.source === node.idx || l.target === node.idx);
  const connEl = document.getElementById('node-detail-connections');
  if (related.length > 0) {
    connEl.innerHTML = `<h5 style="color:var(--text-secondary);font-size:0.8rem;margin-bottom:8px;font-weight:600;">Connections (${related.length}):</h5>` +
      related.map(c => {
        const other = nodes[c.source === node.idx ? c.target : c.source];
        return `<div style="font-size:0.8rem;color:var(--text-tertiary);margin-bottom:6px;padding-left:8px;border-left:2px solid var(--border-color);">
          <strong style="color:var(--text-secondary);">${other?.name || '?'}</strong> — ${c.relationship}
        </div>`;
      }).join('');
  } else {
    connEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">No connections found.</p>';
  }

  document.getElementById('node-details').style.display = 'block';
  document.getElementById('close-node-details')?.addEventListener('click', () => {
    document.getElementById('node-details').style.display = 'none';
  });
  if (window.lucide) lucide.createIcons();
}

// ===================== CHAT =====================
function initChat() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  sendBtn?.addEventListener('click', sendChat);
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  input?.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
  });

  document.querySelectorAll('.suggestion-chip').forEach(chip => {
    chip.addEventListener('click', () => { input.value = chip.dataset.query; sendChat(); });
  });

  document.getElementById('btn-clear-chat')?.addEventListener('click', async () => {
    try {
      await API.del('/chat/history');
      chatHistory = [];
      const msgs = document.getElementById('chat-messages');
      msgs.innerHTML = `<div class="chat-welcome" id="chat-welcome">
        <div class="chat-welcome-icon"><i data-lucide="bot"></i></div>
        <h3>Welcome to Research Chat</h3>
        <p>Ask me anything about your indexed sources.</p>
        <div class="chat-suggestions">
          <button class="suggestion-chip" data-query="Summarize all my research sources"><i data-lucide="file-text"></i> Summarize sources</button>
          <button class="suggestion-chip" data-query="What are the key themes across my research?"><i data-lucide="sparkles"></i> Key themes</button>
        </div>
      </div>`;
      if (window.lucide) lucide.createIcons();
      document.querySelectorAll('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => { input.value = chip.dataset.query; sendChat(); });
      });
      showToast('Chat cleared.', 'info');
    } catch (err) { showToast(err.message, 'error'); }
  });
}

async function loadChatHistory() {
  try {
    const messages = await API.get('/chat/history');
    if (messages.length === 0) return;
    chatHistory = messages.map(m => ({ role: m.role, content: m.content }));
    
    const welcome = document.getElementById('chat-welcome');
    if (welcome) welcome.remove();

    const container = document.getElementById('chat-messages');
    // Only render if not already rendered
    if (container.querySelectorAll('.chat-message').length === 0) {
      messages.forEach(m => appendChatBubble(m.role, m.content));
    }
  } catch (err) {
    console.error('Failed to load chat:', err);
  }
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;

  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.remove();

  appendChatBubble('user', msg);
  chatHistory.push({ role: 'user', content: msg });
  input.value = '';
  input.style.height = 'auto';

  const typingId = appendTyping();

  try {
    const result = await API.post('/chat', { message: msg, history: chatHistory.slice(-8) });
    removeTyping(typingId);
    appendChatBubble('assistant', result.response);
    chatHistory.push({ role: 'assistant', content: result.response });
    loadDashboard();
  } catch (err) {
    removeTyping(typingId);
    appendChatBubble('assistant', `Error: ${err.message}. Check your API key in Settings.`);
  }
}

function appendChatBubble(role, content) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-message ${role}`;
  div.innerHTML = `
    <div class="chat-message-avatar"><i data-lucide="${role === 'user' ? 'user' : 'bot'}"></i></div>
    <div class="chat-message-content">
      <span class="chat-message-role">${role === 'user' ? 'You' : 'NexusAI'}</span>
      <div class="chat-message-text">${role === 'assistant' ? renderMd(content) : esc(content)}</div>
    </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  if (window.lucide) lucide.createIcons();
}

function appendTyping() {
  const container = document.getElementById('chat-messages');
  const id = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.id = id;
  div.className = 'chat-message assistant';
  div.innerHTML = `<div class="chat-message-avatar"><i data-lucide="bot"></i></div>
    <div class="chat-message-content"><span class="chat-message-role">NexusAI</span>
    <div class="chat-typing"><span></span><span></span><span></span></div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  if (window.lucide) lucide.createIcons();
  return id;
}

function removeTyping(id) { document.getElementById(id)?.remove(); }

// ===================== REPORTS =====================
function initReports() {
  document.getElementById('btn-generate-report')?.addEventListener('click', generateReport);
}

async function generateReport() {
  const container = document.getElementById('reports-container');
  const empty = document.getElementById('reports-empty');
  empty.style.display = 'none';

  const loading = document.createElement('div');
  loading.className = 'report-card';
  loading.id = 'report-loading';
  loading.innerHTML = '<div class="report-generating"><div class="spinner"></div><span>Generating comprehensive research report...</span></div>';
  container.prepend(loading);

  try {
    await API.post('/reports/generate', {});
    loading.remove();
    loadReports();
    loadDashboard();
    showToast('Report generated!', 'success');
  } catch (err) {
    loading.remove();
    showToast(`Failed: ${err.message}`, 'error');
    if (container.querySelectorAll('.report-card').length === 0) empty.style.display = 'flex';
  }
}

async function loadReports() {
  try {
    const reports = await API.get('/reports');
    const container = document.getElementById('reports-container');
    const empty = document.getElementById('reports-empty');

    if (reports.length === 0) {
      container.innerHTML = '';
      container.appendChild(empty);
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';
    container.innerHTML = reports.map(r => `
      <div class="report-card" data-report-id="${r.id}">
        <div class="report-card-header">
          <span class="report-card-title">${esc(r.title)}</span>
          <div style="display:flex;align-items:center;gap:12px;">
            <span class="report-card-date">${fmtDate(r.created_at)} · ${r.source_count} sources · ${r.entity_count} entities</span>
            <button class="btn btn-danger btn-sm btn-icon delete-report" data-id="${r.id}" title="Delete"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        <div class="report-card-body">${renderMd(r.content)}</div>
      </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
    container.querySelectorAll('.delete-report').forEach(btn => {
      btn.addEventListener('click', async () => {
        await API.del(`/reports/${btn.dataset.id}`);
        loadReports();
        showToast('Report deleted.', 'info');
      });
    });
  } catch (err) {
    console.error('Failed to load reports:', err);
  }
}

async function loadSampleData() {
  try {
    showToast('Loading curated AI research dataset...', 'info');
    const res = await API.post('/seed', {});
    showToast(res.message || 'Sample research dataset loaded!', 'success');
    await loadDashboard();
    await loadSources();
    const modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'none';
  } catch (err) {
    showToast(`Failed to load sample data: ${err.message}`, 'error');
  }
}

async function resetDatabase() {
  if (!confirm('Are you sure you want to reset the database? All sources, entities, chat history, and reports will be deleted.')) {
    return;
  }
  try {
    const res = await API.post('/reset', {});
    showToast(res.message || 'Database reset successfully', 'info');
    await loadDashboard();
    await loadSources();
    const modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'none';
  } catch (err) {
    showToast(`Reset failed: ${err.message}`, 'error');
  }
}

function initDashboard() {
  document.getElementById('btn-load-sample')?.addEventListener('click', loadSampleData);
  document.getElementById('btn-first-sample')?.addEventListener('click', loadSampleData);
}

// ===================== DASHBOARD =====================
let topicChart = null, entityChart = null;

async function loadDashboard() {
  try {
    const stats = await API.get('/stats');

    animateVal('stat-sources-value', stats.sourceCount);
    animateVal('stat-entities-value', stats.entityCount);
    animateVal('stat-connections-value', stats.connectionCount);
    animateVal('stat-insights-value', stats.insightCount);

    // Recent sources
    const list = document.getElementById('recent-sources-list');
    if (stats.recentSources.length === 0) {
      list.innerHTML = `
        <div class="empty-state" id="dashboard-empty">
          <div class="empty-icon"><i data-lucide="book-open"></i></div>
          <h3>No sources yet</h3>
          <p>Add your first research source, or load our curated AI research dataset to explore the knowledge graph, chat, and reports immediately.</p>
          <div style="display:flex;gap:12px;justify-content:center;margin-top:16px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="btn-first-source"><i data-lucide="plus"></i> Add Source</button>
            <button class="btn btn-secondary" id="btn-first-sample"><i data-lucide="sparkles"></i> Load Sample Data</button>
          </div>
        </div>
      `;
      document.getElementById('btn-first-source')?.addEventListener('click', () => {
        navigateTo('sources');
        toggleSourcePanel(true);
      });
      document.getElementById('btn-first-sample')?.addEventListener('click', loadSampleData);
      if (window.lucide) lucide.createIcons();
    } else {
      list.innerHTML = stats.recentSources.map(s => `
        <div class="recent-source-item">
          <div class="recent-source-icon"><i data-lucide="${s.type === 'url' ? 'globe' : 'file-text'}"></i></div>
          <div class="recent-source-info">
            <div class="recent-source-title">${esc(s.title)}</div>
            <div class="recent-source-meta">${s.entity_count} entities · ${fmtDate(s.created_at)}</div>
          </div>
        </div>
      `).join('');
      if (window.lucide) lucide.createIcons();
    }

    // Charts
    await renderCharts(stats);
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

async function renderCharts(stats) {
  if (!window.Chart) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Topic chart
  const topicCanvas = document.getElementById('topic-chart');
  const topicEmpty = document.getElementById('topic-chart-empty');
  const topicKeys = Object.keys(stats.topicCounts || {});
  if (topicKeys.length === 0) {
    topicEmpty.style.display = 'flex'; topicCanvas.style.display = 'none';
  } else {
    topicEmpty.style.display = 'none'; topicCanvas.style.display = 'block';
    if (topicChart) topicChart.destroy();
    const colors = ['#6366f1','#06b6d4','#a855f7','#10b981','#f59e0b','#ef4444','#f472b6','#60a5fa','#34d399','#fbbf24'];
    topicChart = new Chart(topicCanvas, {
      type: 'doughnut',
      data: {
        labels: topicKeys.slice(0, 10),
        datasets: [{ data: topicKeys.slice(0, 10).map(k => stats.topicCounts[k]), backgroundColor: colors, borderWidth: 0, hoverOffset: 8 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%',
        plugins: { legend: { position: 'right', labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, padding: 12, usePointStyle: true, pointStyleWidth: 8 } } },
        animation: { duration: 800 },
      },
    });
  }

  // Entity type chart
  const entityCanvas = document.getElementById('entity-chart');
  const entityEmpty = document.getElementById('entity-chart-empty');
  const entityTypes = stats.entityTypes || [];
  if (entityTypes.length === 0) {
    entityEmpty.style.display = 'flex'; entityCanvas.style.display = 'none';
  } else {
    entityEmpty.style.display = 'none'; entityCanvas.style.display = 'block';
    if (entityChart) entityChart.destroy();
    entityChart = new Chart(entityCanvas, {
      type: 'bar',
      data: {
        labels: entityTypes.map(e => e.type.charAt(0).toUpperCase() + e.type.slice(1)),
        datasets: [{
          label: 'Entities',
          data: entityTypes.map(e => e.count),
          backgroundColor: entityTypes.map(e => entityColor(e.type) + '99'),
          borderColor: entityTypes.map(e => entityColor(e.type)),
          borderWidth: 1, borderRadius: 6, barPercentage: 0.6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: 'y',
        scales: {
          x: { grid: { color: 'rgba(148,163,184,0.05)' }, ticks: { color: '#64748b', font: { family: 'Inter', size: 11 } } },
          y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'Inter', size: 11 } } },
        },
        plugins: { legend: { display: false } },
        animation: { duration: 800 },
      },
    });
  }
}

// ===================== EXPORT =====================
function initExport() {
  document.getElementById('btn-export-data')?.addEventListener('click', async () => {
    try {
      window.open('/api/export', '_blank');
      showToast('Export started!', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });
}

// ===================== UTILITIES =====================
function entityColor(type) {
  const c = { person: '#f472b6', organization: '#60a5fa', concept: '#a78bfa', technology: '#34d399', location: '#fbbf24', event: '#fb923c', other: '#94a3b8' };
  return c[type?.toLowerCase()] || c.other;
}

function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }

function fmtDate(d) {
  const date = new Date(d);
  const diff = Date.now() - date;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderMd(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h4 style="font-size:1.1rem;">$1</h4>')
    .replace(/^# (.+)$/gm, '<h4 style="font-size:1.2rem;">$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>')
    .replace(/<p><h4/g, '<h4').replace(/<\/h4><\/p>/g, '</h4>')
    .replace(/<p><\/p>/g, '');
}

function animateVal(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const start = performance.now();
  function update(now) {
    const p = Math.min((now - start) / 500, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(current + (target - current) * eased);
    if (p < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };
  toast.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i><span class="toast-message">${message}</span>`;
  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();
  setTimeout(() => { toast.classList.add('toast-out'); setTimeout(() => toast.remove(), 300); }, 4500);
}

// ===================== INIT =====================
function init() {
  if (window.lucide) lucide.createIcons();
  initNavigation();
  initSettings();
  initDashboard();
  initSources();
  initChat();
  initReports();
  initExport();
  loadDashboard();
  loadSources();
  console.log('%c🧠 NexusAI Frontend Loaded', 'color:#6366f1;font-size:14px;font-weight:bold;');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
