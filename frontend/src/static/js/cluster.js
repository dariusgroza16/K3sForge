// ── Welcome screen, cluster dashboard & node resources ───────────────

function _goHome() {
  document.getElementById('mainContainer').style.display    = 'none';
  document.getElementById('existingContainer').style.display = 'none';
  document.getElementById('welcomeScreen').style.display   = '';
  _clusterData = { nodes: null, pods: null, services: null, nodeResources: null };
  document.getElementById('btnHomeFixed').style.display = 'none';
}

function initWelcomeScreen() {
  const btnCreate   = document.getElementById('btnCreateCluster');
  const btnExisting = document.getElementById('btnExistingCluster');

  if (btnCreate) {
    btnCreate.addEventListener('click', () => {
      document.getElementById('welcomeScreen').style.display   = 'none';
      document.getElementById('mainContainer').style.display   = '';
      document.getElementById('btnHomeFixed').style.display    = '';
      // Re-position bubble now that the nav is visible and has layout
      const navList = document.getElementById('navList');
      if (navList) {
        const activeLi = navList.querySelectorAll('li')[activeTabIndex];
        if (activeLi) requestAnimationFrame(() => updateBubblePosition(activeLi));
      }
    });
  }

  if (btnExisting) {
    btnExisting.addEventListener('click', () => {
      document.getElementById('welcomeScreen').style.display    = 'none';
      document.getElementById('existingContainer').style.display = '';
      document.getElementById('btnHomeFixed').style.display     = '';
    });
  }

  const btnBackToWelcome = document.getElementById('btnBackToWelcome');
  if (btnBackToWelcome) {
    btnBackToWelcome.addEventListener('click', () => {
      document.getElementById('existingContainer').style.display = 'none';
      document.getElementById('welcomeScreen').style.display     = '';
      document.getElementById('btnHomeFixed').style.display      = 'none';
    });
  }

  const btnHomeFixed = document.getElementById('btnHomeFixed');
  if (btnHomeFixed) {
    btnHomeFixed.addEventListener('click', () => {
      if (_eventSource) {
        showConfirmToast('A process is still running. Go home anyway?', () => {
          if (_eventSource) { _eventSource.close(); _eventSource = null; }
          _goHome();
        });
      } else {
        _goHome();
      }
    });
  }

  const btnProceed = document.getElementById('btnProceedKubeconfig');
  if (btnProceed) {
    btnProceed.addEventListener('click', () => enterClusterDashboard());
  }

  // ── Existing cluster uninstall ─────────────────────────────────────
  const btnExistingUninstall = document.getElementById('btnExistingUninstall');
  if (btnExistingUninstall) {
    btnExistingUninstall.addEventListener('click', () => startExistingUninstall());
  }
  const btnAbortExistingUninstall = document.getElementById('btnAbortExistingUninstall');
  if (btnAbortExistingUninstall) {
    btnAbortExistingUninstall.addEventListener('click', () => {
      showConfirmToast('Abort the running uninstall?', async () => {
        try { await fetch('/deploy-abort', { method: 'POST' }); }
        catch(e) { showToast('Failed to send abort signal'); }
      });
    });
  }
  wireSecretToggle('toggleExistingSSHKey', 'existingSSHKey');

  const btnBackToKubeconfig = document.getElementById('btnBackToKubeconfig');
  if (btnBackToKubeconfig) {
    btnBackToKubeconfig.addEventListener('click', () => {
      document.getElementById('clusterDashboard').style.display = 'none';
      document.getElementById('kubeconfigView').style.display   = '';
      _clusterData = { nodes: null, pods: null, services: null, nodeResources: null };
    });
  }

  const btnRefresh = document.getElementById('btnRefreshSection');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => refreshCurrentSection());
  }

  // Cluster navbar tab switching
  const clusterNavList = document.getElementById('clusterNavList');
  if (clusterNavList) {
    clusterNavList.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        switchClusterSection(li.dataset.section);
        updateClusterNavBubble(li);
      });
    });
  }

  // Namespace filter
  const nsFilter = document.getElementById('nsFilter');
  if (nsFilter) {
    nsFilter.addEventListener('change', () => {
      if (_clusterData.pods) {
        renderPodsTable(_clusterData.pods.headers, _clusterData.pods.rows);
      }
    });
  }
}

// ── Enter dashboard ──────────────────────────────────────────────────
async function enterClusterDashboard() {
  const kubeconfig = document.getElementById('kubeconfigInput')?.value.trim();
  if (!kubeconfig) { showToast('Please paste your kubeconfig first.'); return; }

  const btn = document.getElementById('btnProceedKubeconfig');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  try {
    document.getElementById('kubeconfigView').style.display   = 'none';
    document.getElementById('clusterDashboard').style.display = '';

    _clusterData = { nodes: null, pods: null, services: null, nodeResources: null };
    _activeClusterSection = 'overview';
    switchClusterSection('overview', false);
    initClusterNavBubble();

    setTableLoading('nodesTableContainer');
    setTableLoading('podsTableContainer');
    setTableLoading('servicesTableContainer');
    const nrcEl = document.getElementById('nodeResourcesContainer');
    if (nrcEl) nrcEl.innerHTML = '<div class="nrc-loading"><span class="cluster-spinner"></span>Loading resource metrics…</div>';

    const [nodesRes, podsRes, svcRes, resourcesRes] = await Promise.all([
      fetchKubectl('/kubectl-nodes',          kubeconfig),
      fetchKubectl('/kubectl-pods',           kubeconfig),
      fetchKubectl('/kubectl-services',       kubeconfig),
      fetchKubectl('/kubectl-node-resources', kubeconfig),
    ]);

    handleNodesData(nodesRes);
    handlePodsData(podsRes);
    handleServicesData(svcRes);
    handleNodeResourcesData(resourcesRes);

  } catch(e) {
    showToast('Network error while loading cluster info.');
    console.error(e);
    document.getElementById('clusterDashboard').style.display = 'none';
    document.getElementById('kubeconfigView').style.display   = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Proceed'; }
  }
}

async function fetchKubectl(endpoint, kubeconfig) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kubeconfig }),
  });
  return res.json();
}

async function refreshCurrentSection() {
  const kubeconfig = document.getElementById('kubeconfigInput')?.value.trim();
  if (!kubeconfig) { showToast('Kubeconfig missing.'); return; }

  const btn = document.getElementById('btnRefreshSection');
  if (btn) btn.disabled = true;

  const section      = _activeClusterSection;
  const containerMap = { overview: 'nodesTableContainer', workloads: 'podsTableContainer', services: 'servicesTableContainer' };
  setTableLoading(containerMap[section]);

  try {
    if (section === 'overview') {
      const nrcEl = document.getElementById('nodeResourcesContainer');
      if (nrcEl) nrcEl.innerHTML = '<div class="nrc-loading"><span class="cluster-spinner"></span>Loading resource metrics…</div>';
      const [json, resourcesJson] = await Promise.all([
        fetchKubectl('/kubectl-nodes',          kubeconfig),
        fetchKubectl('/kubectl-node-resources', kubeconfig),
      ]);
      handleNodesData(json);
      handleNodeResourcesData(resourcesJson);
    } else {
      const endpointMap = { workloads: '/kubectl-pods', services: '/kubectl-services' };
      const json = await fetchKubectl(endpointMap[section], kubeconfig);
      if (section === 'workloads') handlePodsData(json);
      else if (section === 'services') handleServicesData(json);
    }
  } catch(e) {
    showToast('Refresh failed.');
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Data handlers ────────────────────────────────────────────────────
function handleNodesData(json) {
  if (json.status === 'error') {
    setTableError('nodesTableContainer', json.message);
    document.getElementById('overviewSubtitle').textContent = 'Error loading nodes';
    return;
  }
  _clusterData.nodes = json;
  renderClusterTable('nodesTableContainer', json.headers, json.rows, 'STATUS');
  const sub = document.getElementById('overviewSubtitle');
  if (sub) sub.textContent = `${json.rows.length} node${json.rows.length !== 1 ? 's' : ''}`;
}

function handlePodsData(json) {
  if (json.status === 'error') {
    setTableError('podsTableContainer', json.message);
    document.getElementById('workloadsSubtitle').textContent = 'Error loading pods';
    return;
  }
  _clusterData.pods = json;
  populateNamespaceFilter(json.rows, json.headers);
  renderPodsTable(json.headers, json.rows);
}

function handleServicesData(json) {
  if (json.status === 'error') {
    setTableError('servicesTableContainer', json.message);
    document.getElementById('servicesSubtitle').textContent = 'Error loading services';
    return;
  }
  _clusterData.services = json;
  renderClusterTable('servicesTableContainer', json.headers, json.rows);
  const sub = document.getElementById('servicesSubtitle');
  if (sub) sub.textContent = `${json.rows.length} service${json.rows.length !== 1 ? 's' : ''}`;
}

function handleNodeResourcesData(json) {
  const container = document.getElementById('nodeResourcesContainer');
  if (!container) return;
  if (!json || json.status === 'error' || !json.nodes?.length) {
    container.innerHTML = '';
    return;
  }
  _clusterData.nodeResources = json;
  renderNodeResourceCards(json);
}

// ── Node resource cards ──────────────────────────────────────────────
function renderNodeResourceCards(resourcesData) {
  const container = document.getElementById('nodeResourcesContainer');
  if (!container || !resourcesData?.nodes?.length) return;

  const podRows    = _clusterData.pods?.rows    || [];
  const podHeaders = _clusterData.pods?.headers || [];
  const nodeCol    = podHeaders.indexOf('NODE');
  const podCountPerNode = {};
  if (nodeCol !== -1) {
    podRows.forEach(row => {
      const node = row[nodeCol];
      if (node && node !== '<none>') podCountPerNode[node] = (podCountPerNode[node] || 0) + 1;
    });
  }

  const grid = document.createElement('div');
  grid.className = 'node-resources-grid';

  resourcesData.nodes.forEach(node => {
    const card     = document.createElement('div');
    card.className = 'node-resource-card';

    const podsUsed = podCountPerNode[node.name] || 0;
    const podsMax  = node.pods_allocatable || 110;
    const podsPct  = Math.min(100, Math.round((podsUsed / podsMax) * 100));

    let cpuHtml, memHtml;
    if (node.metrics_available && node.cpu_percent !== null) {
      const cpuPct = parseFloat(node.cpu_percent) || 0;
      const memPct = parseFloat(node.memory_percent) || 0;
      cpuHtml = `<div class="nrc-metric"><div class="nrc-metric-label"><span>CPU</span><span class="nrc-metric-value">${escapeHtml(node.cpu_used)} / ${escapeHtml(_formatCpu(node.cpu_allocatable))}</span></div><div class="nrc-bar-track"><div class="nrc-bar-fill ${_barClass(cpuPct)}" style="width:${cpuPct}%"></div></div><span class="nrc-pct">${cpuPct}%</span></div>`;
      memHtml = `<div class="nrc-metric"><div class="nrc-metric-label"><span>Memory</span><span class="nrc-metric-value">${escapeHtml(_formatMemory(node.memory_used))} / ${escapeHtml(_formatMemory(node.memory_allocatable))}</span></div><div class="nrc-bar-track"><div class="nrc-bar-fill ${_barClass(memPct)}" style="width:${memPct}%"></div></div><span class="nrc-pct">${memPct}%</span></div>`;
    } else {
      cpuHtml = `<div class="nrc-metric"><div class="nrc-metric-label"><span>CPU</span><span class="nrc-metric-value nrc-dim">Allocatable: ${escapeHtml(_formatCpu(node.cpu_allocatable))}</span></div><div class="nrc-no-metrics">metrics-server unavailable</div></div>`;
      memHtml = `<div class="nrc-metric"><div class="nrc-metric-label"><span>Memory</span><span class="nrc-metric-value nrc-dim">Allocatable: ${escapeHtml(_formatMemory(node.memory_allocatable))}</span></div><div class="nrc-no-metrics">metrics-server unavailable</div></div>`;
    }

    const podsHtml = `<div class="nrc-metric"><div class="nrc-metric-label"><span>Pods</span><span class="nrc-metric-value">${podsUsed} / ${podsMax}</span></div><div class="nrc-bar-track"><div class="nrc-bar-fill ${_barClass(podsPct)}" style="width:${podsPct}%"></div></div><span class="nrc-pct">${podsPct}%</span></div>`;

    card.innerHTML = `<div class="nrc-header"><span class="nrc-name">${escapeHtml(node.name)}</span><span class="nrc-role nrc-role-${escapeHtml(node.role)}">${escapeHtml(node.role.toUpperCase())}</span></div>${cpuHtml}${memHtml}${podsHtml}`;
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

function _barClass(pct) {
  if (pct >= 85) return 'bar-critical';
  if (pct >= 60) return 'bar-warn';
  return 'bar-ok';
}

function _formatCpu(cpu) {
  if (!cpu) return 'N/A';
  if (cpu.endsWith('m')) {
    const cores = parseFloat(cpu) / 1000;
    return cores >= 1 ? `${cores % 1 === 0 ? cores : cores.toFixed(1)} cores` : cpu;
  }
  const n = parseFloat(cpu);
  return isNaN(n) ? cpu : `${n} core${n !== 1 ? 's' : ''}`;
}

function _formatMemory(mem) {
  if (!mem) return 'N/A';
  if (mem.endsWith('Mi')) { const mb = parseFloat(mem); return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GiB` : `${mb.toFixed(0)} MiB`; }
  if (mem.endsWith('Ki')) { const kb = parseFloat(mem); const gb = kb / (1024 * 1024); return gb >= 1 ? `${gb.toFixed(1)} GiB` : `${(kb / 1024).toFixed(0)} MiB`; }
  if (mem.endsWith('Gi')) return `${parseFloat(mem).toFixed(1)} GiB`;
  const n = parseFloat(mem);
  if (!isNaN(n)) {
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GiB`;
    if (n >= 1048576)    return `${(n / 1048576).toFixed(0)} MiB`;
  }
  return mem;
}

// ── Namespace filter ─────────────────────────────────────────────────
function populateNamespaceFilter(rows, headers) {
  const nsIndex = headers.indexOf('NAMESPACE');
  const select  = document.getElementById('nsFilter');
  if (!select || nsIndex === -1) return;
  const namespaces = [...new Set(rows.map(r => r[nsIndex]).filter(Boolean))].sort();
  const currentVal = select.value;
  select.innerHTML = '<option value="">All namespaces</option>';
  namespaces.forEach(ns => {
    const opt = document.createElement('option');
    opt.value = ns; opt.textContent = ns;
    if (ns === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderPodsTable(headers, rows) {
  const nsIndex   = headers.indexOf('NAMESPACE');
  const nameIndex = headers.indexOf('NAME');
  const filterVal = document.getElementById('nsFilter')?.value || '';
  const filteredRows = filterVal && nsIndex !== -1 ? rows.filter(r => r[nsIndex] === filterVal) : rows;

  const PODS_HIDDEN = new Set(['NOMINATED', 'NODE', 'READINESS', 'GATES']);
  let orderedHeaders = headers;
  let orderedRows    = filteredRows;
  if (nsIndex !== -1 && nameIndex !== -1 && nsIndex !== nameIndex) {
    const desired = ['NAME', 'NAMESPACE', ...headers.filter(h => h !== 'NAME' && h !== 'NAMESPACE' && !PODS_HIDDEN.has(h))];
    const idxMap  = desired.map(h => headers.indexOf(h)).filter(i => i !== -1);
    orderedHeaders = idxMap.map(i => headers[i]);
    orderedRows    = filteredRows.map(r => idxMap.map(i => r[i] ?? '<none>'));
  } else {
    const idxMap  = headers.map((h, i) => i).filter(i => !PODS_HIDDEN.has(headers[i]));
    orderedHeaders = idxMap.map(i => headers[i]);
    orderedRows    = filteredRows.map(r => idxMap.map(i => r[i] ?? '<none>'));
  }

  renderClusterTable('podsTableContainer', orderedHeaders, orderedRows, 'STATUS');
  const sub = document.getElementById('workloadsSubtitle');
  if (sub) {
    sub.textContent = filterVal
      ? `${filteredRows.length} pod${filteredRows.length !== 1 ? 's' : ''} in "${filterVal}"`
      : `${filteredRows.length} pod${filteredRows.length !== 1 ? 's' : ''} across all namespaces`;
  }
}

// ── Generic table renderer ───────────────────────────────────────────
function renderClusterTable(containerId, headers, rows, statusCol) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!headers.length || !rows.length) {
    container.innerHTML = '<div class="cluster-table-msg">No data returned.</div>';
    return;
  }
  const table = document.createElement('table');
  table.className = 'nodes-table';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach(h => { const th = document.createElement('th'); th.textContent = h; headerRow.appendChild(th); });
  thead.appendChild(headerRow); table.appendChild(thead);
  const statusIdx = statusCol ? headers.indexOf(statusCol) : -1;
  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    row.forEach((cell, i) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (i === statusIdx) {
        const v = cell.toLowerCase();
        if (v === 'ready' || v === 'running' || v === 'active') td.className = 'status-ready';
        else if (v !== '<none>' && v !== 'completed' && v !== 'succeeded') td.className = 'status-notready';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.innerHTML = '';
  container.appendChild(table);
}

function setTableLoading(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '<div class="cluster-table-msg"><span class="cluster-spinner"></span>Loading…</div>';
}

function setTableError(containerId, msg) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="cluster-table-msg" style="color:#ef4444;">❌ ${escapeHtml(msg)}</div>`;
}

// ── Cluster navbar ───────────────────────────────────────────────────
function switchClusterSection(sectionName, withBubble = true) {
  _activeClusterSection = sectionName;
  const navList = document.getElementById('clusterNavList');
  if (navList) {
    navList.querySelectorAll('li').forEach(li => {
      li.classList.toggle('active', li.dataset.section === sectionName);
    });
    if (withBubble) {
      const activeLi = navList.querySelector(`li[data-section="${sectionName}"]`);
      updateClusterNavBubble(activeLi);
    }
  }
  document.querySelectorAll('.cluster-section').forEach(sec => {
    sec.style.display = sec.dataset.section === sectionName ? '' : 'none';
  });
}

function updateClusterNavBubble(element) {
  const bubble = document.getElementById('clusterNavBubble');
  if (!bubble || !element) return;
  const navEl = element.closest('.cluster-nav');
  if (!navEl) return;
  const navRect = navEl.getBoundingClientRect();
  const elRect  = element.getBoundingClientRect();
  const pad = 2;
  bubble.style.left   = `${elRect.left - navRect.left - pad}px`;
  bubble.style.top    = `${elRect.top  - navRect.top  - pad}px`;
  bubble.style.width  = `${elRect.width  + pad * 2}px`;
  bubble.style.height = `${elRect.height + pad * 2}px`;
}

function initClusterNavBubble() {
  const navList = document.getElementById('clusterNavList');
  if (!navList) return;
  const activeLi = navList.querySelector('li.active');
  if (activeLi) setTimeout(() => updateClusterNavBubble(activeLi), 40);
}

// ── Existing cluster uninstall ───────────────────────────────────────
function startExistingUninstall() {
  const username = document.getElementById('existingSSHUser')?.value.trim();
  const sshKey   = document.getElementById('existingSSHKey')?.value.trim();
  if (!username || !sshKey) {
    showToast('SSH username and private key are required to uninstall.');
    return;
  }
  showConfirmToast('Uninstall K3s from all nodes in this cluster?', () => {
    const runningEl = document.getElementById('existingUninstallRunning');
    const stepsEl   = document.getElementById('existingUninstallSteps');
    const titleEl   = document.getElementById('existingUninstallTitle');
    const abortBtn  = document.getElementById('btnAbortExistingUninstall');
    const startBtn  = document.getElementById('btnExistingUninstall');
    if (runningEl) runningEl.style.display = '';
    if (startBtn)  startBtn.style.display  = 'none';
    if (stepsEl)   stepsEl.innerHTML = '<div style="color:rgba(255,255,255,0.5);text-align:center;">Connecting…</div>';

    const params = new URLSearchParams({ username, ssh_key: sshKey });
    const es = new EventSource(`/uninstall?${params.toString()}`);
    _eventSource = es;

    const DONE_ICON = '✓';
    const FAIL_ICON = '✕';

    es.onmessage = (ev) => {
      let data; try { data = JSON.parse(ev.data); } catch { return; }
      if (data.type === 'steps') {
        stepsEl.innerHTML = '';
        data.steps.forEach(s => {
          const card = document.createElement('div');
          card.className = 'step-card pending';
          card.id = `ex-step-${s.id}`;
          card.innerHTML = `<div class="step-icon"></div><div class="step-label">${escapeHtml(s.label)}</div><div class="step-task"></div>`;
          stepsEl.appendChild(card);
        });
        return;
      }
      const setCard = (id, state, taskText) => {
        const card = document.getElementById(`ex-step-${id}`);
        if (!card) return;
        card.className = `step-card ${state}`;
        const icon = card.querySelector('.step-icon');
        if (state === 'done'   && icon) icon.textContent = DONE_ICON;
        if (state === 'failed' && icon) icon.textContent = FAIL_ICON;
        if (taskText !== undefined) { const t = card.querySelector('.step-task'); if (t) t.textContent = taskText; }
      };
      if (data.type === 'step_start')   { setCard(data.step, 'active', ''); return; }
      if (data.type === 'step_done')    { setCard(data.step, 'done'); return; }
      if (data.type === 'task')         { setCard(data.step, 'active', data.task); return; }
      if (data.type === 'task_warning') { setCard(data.step, 'active', '⚠ ' + (data.msg || '').slice(0, 80)); return; }
      if (data.type === 'step_failed')  { setCard(data.step, 'failed', 'Failed'); return; }
      if (data.type === 'finished') {
        es.close(); _eventSource = null;
        if (abortBtn) abortBtn.style.display = 'none';
        if (data.success) {
          if (titleEl) titleEl.textContent = 'Cluster uninstalled successfully';
          showToast('Cluster uninstalled successfully.', 5000);
        } else if (data.aborted) {
          if (titleEl) titleEl.textContent = 'Uninstall aborted';
          if (startBtn) startBtn.style.display = '';
        } else {
          if (titleEl) titleEl.textContent = 'Uninstall failed — check steps above';
          if (startBtn) startBtn.style.display = '';
        }
        return;
      }
    };
    es.onerror = () => {
      es.close(); _eventSource = null;
      if (abortBtn) abortBtn.style.display = 'none';
      if (titleEl) titleEl.textContent = 'Connection lost';
      if (startBtn) startBtn.style.display = '';
    };
  });
}
