// ── Deploy / Uninstall ────────────────────────────────────────────────

const STEP_ICONS = {
  docker: '🐳', primordial: '⚡', masters: '🖥️', workers: '⚙️',
};
const DONE_ICON = '✓';
const FAIL_ICON = '✕';

const STEP_DESCRIPTIONS = {
  docker:     'Installing the container runtime across all nodes',
  primordial: 'Installing K3s and bootstrapping the primary control plane',
  masters:    'Joining additional nodes to the control plane',
  workers:    'Registering worker nodes with the control plane',
};

const UNINSTALL_DESCRIPTIONS = {
  workers:    'Removing K3s from worker nodes',
  masters:    'Removing K3s from secondary control plane nodes',
  primordial: 'Removing K3s from the primary node and cleaning up credentials',
};

function _getSSHCreds() {
  return {
    username: document.getElementById('sshUsername')?.value.trim() || '',
    sshKey:   document.getElementById('sshKey')?.value.trim()      || '',
  };
}

function _getDeployOptions() {
  return {
    token:  document.getElementById('k3sToken')?.value.trim()  || '',
    docker: document.getElementById('dockerToggle')?.checked   || false,
  };
}

// ── Runtime toggle label highlight ───────────────────────────────────────
(function _initRuntimeToggle() {
  document.addEventListener('DOMContentLoaded', () => {
    const toggle     = document.getElementById('dockerToggle');
    const lblDefault = document.getElementById('runtimeLabelContainerd');
    const lblDocker  = document.getElementById('runtimeLabelDocker');
    if (!toggle) return;
    toggle.addEventListener('change', () => {
      const useDocker = toggle.checked;
      lblDefault?.classList.toggle('active', !useDocker);
      lblDocker?.classList.toggle('active',  useDocker);
    });
  });
}());

// ── Deploy Hex Canvas globals ─────────────────────────────────────────
let _deployNodes = {};   // nodeName → { el, role, color, hex, ring, nameT, statusT }
let _phaseSteps  = [];   // ordered steps array from the 'steps' SSE event

function _renderDeployCanvas(container, steps, isUninstall) {
  _nodeStatuses = {};
  _deployNodes  = {};
  _phaseSteps   = steps;
  container.innerHTML = '';

  const masters = vms.filter(n => n.role === 'master');
  const workers = vms.filter(n => n.role === 'worker');
  const svgNS   = 'http://www.w3.org/2000/svg';
  const COLS    = 4;
  const mR = 52, wR = 44;
  const rowGap = 24, tierGap = 56;
  const padV   = 32;
  const mCount = masters.length;
  const wCount = workers.length;
  const mRows  = Math.max(1, Math.ceil(mCount / COLS));
  const wRows  = wCount > 0 ? Math.ceil(wCount / COLS) : 0;
  const mTierH = mRows * (mR * 2) + Math.max(0, mRows - 1) * rowGap;
  const wTierH = wRows > 0 ? wRows * (wR * 2) + Math.max(0, wRows - 1) * rowGap : 0;
  const cW     = container.clientWidth || 600;
  const svgH   = padV + mTierH + (wRows > 0 ? tierGap + wTierH : 0) + padV;

  const svg = document.createElementNS(svgNS, 'svg');
  svg.id = 'deployHexSvg';
  svg.setAttribute('viewBox', `0 0 ${cW} ${svgH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.cssText = 'width:100%;height:auto;overflow:visible;display:block;padding:8px 0;';

  function nodeX(j, rowCount) { return Math.round((j + 1) * (cW / (rowCount + 1))); }

  // Tier separator
  if (wRows > 0) {
    const sepY = padV + mTierH + tierGap / 2;
    const sep = document.createElementNS(svgNS, 'line');
    sep.setAttribute('x1', 20); sep.setAttribute('y1', sepY);
    sep.setAttribute('x2', cW - 20); sep.setAttribute('y2', sepY);
    sep.setAttribute('stroke', 'rgba(255,255,255,0.05)');
    sep.setAttribute('stroke-width', '1');
    sep.setAttribute('stroke-dasharray', '4 8');
    svg.appendChild(sep);
  }

  // Tier labels
  function tierLabel(text, y, col) {
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', 16); t.setAttribute('y', y);
    t.setAttribute('fill', col); t.setAttribute('font-size', '8');
    t.setAttribute('font-weight', '700'); t.setAttribute('letter-spacing', '2');
    t.setAttribute('dominant-baseline', 'middle'); t.setAttribute('opacity', '0.4');
    t.textContent = text; return t;
  }
  svg.appendChild(tierLabel('CONTROL PLANE', padV + 8, '#9cff6e'));
  if (wRows > 0) svg.appendChild(tierLabel('WORKER NODES', padV + mTierH + tierGap + 8, '#7dd3fc'));

  // Connections layer (drawn under nodes)
  const edgeGroup = document.createElementNS(svgNS, 'g');
  edgeGroup.id = 'dhex-edges';
  svg.appendChild(edgeGroup);

  function makeHex(node, i, total, baseY, r, role) {
    const row      = Math.floor(i / COLS);
    const col      = i % COLS;
    const rowCount = Math.min(COLS, total - row * COLS);
    const x        = nodeX(col, rowCount);
    const cy       = baseY + r + row * (r * 2 + rowGap);
    const color    = role === 'master' ? '#9cff6e' : '#7dd3fc';
    const g = document.createElementNS(svgNS, 'g');
    g.dataset.deployNode = node.name;

    // Outer pulse ring
    const ring = document.createElementNS(svgNS, 'polygon');
    ring.setAttribute('points', hexPts(x, cy, r + 11));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'rgba(99,102,241,0.55)');
    ring.setAttribute('stroke-width', '1.5');
    ring.style.opacity = '0';
    ring.classList.add('dhex-ring');
    g.appendChild(ring);

    // Hex body
    const hex = document.createElementNS(svgNS, 'polygon');
    hex.setAttribute('points', hexPts(x, cy, r));
    hex.setAttribute('fill', 'rgba(255,255,255,0.02)');
    hex.setAttribute('stroke', 'rgba(255,255,255,0.11)');
    hex.setAttribute('stroke-width', '1.5');
    hex.classList.add('dhex-body');
    g.appendChild(hex);

    // Node name
    const nameT = document.createElementNS(svgNS, 'text');
    nameT.setAttribute('x', x); nameT.setAttribute('y', cy - (r >= 50 ? 10 : 7));
    nameT.setAttribute('text-anchor', 'middle');
    nameT.setAttribute('dominant-baseline', 'middle');
    nameT.setAttribute('fill', 'rgba(255,255,255,0.22)');
    nameT.setAttribute('font-size', r >= 50 ? '13' : '11');
    nameT.setAttribute('font-weight', '700');
    nameT.classList.add('dhex-name');
    nameT.textContent = node.name;
    g.appendChild(nameT);

    // Status label
    const statusT = document.createElementNS(svgNS, 'text');
    statusT.setAttribute('x', x); statusT.setAttribute('y', cy + (r >= 50 ? 10 : 7));
    statusT.setAttribute('text-anchor', 'middle');
    statusT.setAttribute('dominant-baseline', 'middle');
    statusT.setAttribute('fill', 'rgba(255,255,255,0.16)');
    statusT.setAttribute('font-size', '9');
    statusT.setAttribute('font-weight', '700');
    statusT.setAttribute('letter-spacing', '1.2');
    statusT.classList.add('dhex-status');
    statusT.textContent = 'READY';
    g.appendChild(statusT);

    svg.appendChild(g);
    _deployNodes[node.name] = { el: g, role, x, cy, r, color, hex, ring, nameT, statusT };
  }

  masters.forEach((m, i) => makeHex(m, i, mCount, padV, mR, 'master'));
  if (wRows > 0) workers.forEach((w, i) => makeHex(w, i, wCount, padV + mTierH + tierGap, wR, 'worker'));

  container.appendChild(svg);

  // ── Phase strip (compact horizontal progress bar below canvas) ────
  const strip = document.createElement('div');
  strip.className = 'deploy-phase-strip';
  strip.id = 'deployPhaseStrip';
  const descs = isUninstall ? UNINSTALL_DESCRIPTIONS : STEP_DESCRIPTIONS;
  steps.forEach((s, i) => {
    if (i > 0) {
      const conn = document.createElement('div');
      conn.className = 'dps-connector';
      conn.id = `dps-conn-${steps[i - 1].id}`;
      strip.appendChild(conn);
    }
    const item = document.createElement('div');
    item.className = 'dps-step dps-step--pending';
    item.id = `dps-${s.id}`;
    item.innerHTML = `
      <div class="dps-dot"></div>
      <div class="dps-info">
        <span class="dps-name">${escapeHtml(s.label)}</span>
        <span class="dps-desc">${escapeHtml(descs[s.id] || '')}</span>
      </div>
      <div class="dps-badge"></div>`;
    strip.appendChild(item);
  });
  container.appendChild(strip);
}

function _setPhaseState(stepId, state) {
  const item = document.getElementById(`dps-${stepId}`);
  if (item) {
    item.className = `dps-step dps-step--${state}`;
    const badge = item.querySelector('.dps-badge');
    if (badge) {
      if (state === 'active')       badge.innerHTML = '<span class="dps-spinner"></span><span class="dps-badge-text">In progress</span>';
      else if (state === 'done')    badge.innerHTML = '<span class="dps-badge-done">✓ Complete</span>';
      else if (state === 'failed')  badge.innerHTML = '<span class="dps-badge-failed">✕ Failed</span>';
      else if (state === 'aborted') badge.innerHTML = '<span class="dps-badge-aborted">⊘ Aborted</span>';
      else badge.innerHTML = '';
    }
    if (state === 'done') {
      const idx = _phaseSteps.findIndex(s => s.id === stepId);
      if (idx > 0) {
        const conn = document.getElementById(`dps-conn-${_phaseSteps[idx - 1].id}`);
        if (conn) conn.classList.add('dps-connector--done');
      }
    }
  }
  const nodes = _nodeStatuses[stepId] || {};
  if (state === 'done') {
    Object.keys(nodes).forEach(n => { if (nodes[n] !== 'failed') _setNodeStatus(stepId, n, 'done'); });
  } else if (state === 'failed') {
    Object.keys(nodes).forEach(n => { if (nodes[n] === 'active') _setNodeStatus(stepId, n, 'failed'); });
  } else if (state === 'aborted') {
    Object.keys(nodes).forEach(n => { if (nodes[n] !== 'done' && nodes[n] !== 'failed') _setNodeStatus(stepId, n, 'aborted'); });
  }
}

function _setNodeStatus(stepId, nodeName, status) {
  if (!_nodeStatuses[stepId]) _nodeStatuses[stepId] = {};
  _nodeStatuses[stepId][nodeName] = status;
  const nd = _deployNodes[nodeName];
  if (!nd) return;
  const { el, role, color, hex, ring, nameT, statusT } = nd;
  el.classList.remove('dhn-idle', 'dhn-active', 'dhn-done', 'dhn-failed', 'dhn-aborted');
  if (status === 'active') {
    el.classList.add('dhn-active');
    hex.setAttribute('fill', 'rgba(99,102,241,0.09)');
    hex.setAttribute('stroke', 'rgba(99,102,241,0.82)');
    hex.setAttribute('stroke-width', '2');
    ring.style.opacity = '1';
    nameT.setAttribute('fill', '#fff');
    statusT.setAttribute('fill', 'rgba(99,102,241,0.9)');
    statusT.textContent = 'WORKING…';
  } else if (status === 'done') {
    el.classList.add('dhn-done');
    // Draw a connection line from primordial master to this node
    const primName = primordialMaster?.name;
    const primNd   = primName ? _deployNodes[primName] : null;
    if (primNd && nodeName !== primName) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', primNd.x); line.setAttribute('y1', primNd.cy);
      line.setAttribute('x2', nd.x);     line.setAttribute('y2', nd.cy);
      line.setAttribute('stroke', role === 'master' ? 'rgba(156,255,110,0.18)' : 'rgba(125,211,252,0.15)');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '5 4');
      line.classList.add('dhex-edge');
      document.getElementById('dhex-edges')?.appendChild(line);
    }
    hex.setAttribute('fill', role === 'master' ? 'rgba(156,255,110,0.09)' : 'rgba(125,211,252,0.09)');
    hex.setAttribute('stroke', color);
    hex.setAttribute('stroke-width', '2');
    ring.style.opacity = '0';
    nameT.setAttribute('fill', '#fff');
    statusT.setAttribute('fill', color);
    statusT.textContent = '✓ DONE';
  } else if (status === 'failed') {
    el.classList.add('dhn-failed');
    hex.setAttribute('fill', 'rgba(239,68,68,0.09)');
    hex.setAttribute('stroke', '#ef4444');
    hex.setAttribute('stroke-width', '2');
    ring.style.opacity = '0';
    nameT.setAttribute('fill', '#fca5a5');
    statusT.setAttribute('fill', '#f87171');
    statusT.textContent = '✕ FAILED';
  } else if (status === 'aborted') {
    el.classList.add('dhn-aborted');
    hex.setAttribute('fill', 'rgba(245,158,11,0.04)');
    hex.setAttribute('stroke', 'rgba(245,158,11,0.32)');
    hex.setAttribute('stroke-width', '1.5');
    ring.style.opacity = '0';
    nameT.setAttribute('fill', 'rgba(255,255,255,0.32)');
    statusT.setAttribute('fill', 'rgba(245,158,11,0.5)');
    statusT.textContent = 'ABORTED';
  }
}

function _showDeployIdle() {
  document.getElementById('deployIdle').style.display      = '';
  document.getElementById('deployRunning').style.display   = 'none';
  document.getElementById('uninstallRunning').style.display = 'none';
  const panel = document.getElementById('kubeconfigPanel');
  if (panel) panel.style.display = 'none';
}

function _showDeployRunning() {
  document.getElementById('deployIdle').style.display       = 'none';
  document.getElementById('deployRunning').style.display    = '';
  document.getElementById('uninstallRunning').style.display  = 'none';
  document.getElementById('abortDeploy').style.display      = '';
  document.getElementById('uninstallCluster').style.display = 'none';
  document.getElementById('redeployCluster').style.display  = 'none';
  const panel = document.getElementById('kubeconfigPanel');
  if (panel) panel.style.display = 'none';
  document.getElementById('deployTitle').textContent    = 'Deploying…';
  document.getElementById('deploySubtitle').textContent = 'Installing K3s on all nodes via SSH';
  const homeBtn = document.getElementById('btnHomeFixed');
  if (homeBtn) homeBtn.style.display = 'none';
}

function _showUninstallRunning() {
  document.getElementById('deployIdle').style.display       = 'none';
  document.getElementById('deployRunning').style.display    = 'none';
  document.getElementById('uninstallRunning').style.display = '';
  document.getElementById('abortUninstall').style.display   = '';
  document.getElementById('uninstallTitle').textContent    = 'Uninstalling…';
  document.getElementById('uninstallSubtitle').textContent = 'Running the k3s-uninstall playbook';
  const homeBtn = document.getElementById('btnHomeFixed');
  if (homeBtn) homeBtn.style.display = 'none';
}

function startDeploy() {
  const { username, sshKey } = _getSSHCreds();
  if (!username || !sshKey) {
    showToast('⚠️ SSH credentials from the connection tab are required.', 4000);
    return;
  }
  const { token, docker } = _getDeployOptions();
  if (!token) {
    showToast('⚠️ A cluster token is required in the deploy options.', 4000);
    return;
  }
  _showDeployRunning();
  const container = document.getElementById('deploySteps');
  container.innerHTML = '<div style="color:rgba(255,255,255,0.5);text-align:center;">Connecting…</div>';

  const params = new URLSearchParams({ username, ssh_key: sshKey, token, docker });
  const es = new EventSource(`/deploy?${params.toString()}`);
  _eventSource = es;

  es.onmessage = (ev) => {
    let data; try { data = JSON.parse(ev.data); } catch { return; }
    if (data.type === 'steps')      { _renderDeployCanvas(container, data.steps, false); return; }
    if (data.type === 'step_start')  { _setPhaseState(data.step, 'active'); return; }
    if (data.type === 'step_done')   { _setPhaseState(data.step, 'done'); return; }
    if (data.type === 'step_failed') { _setPhaseState(data.step, 'failed'); return; }
    if (data.type === 'node_start')  { _setNodeStatus(data.step, data.node, 'active'); return; }
    if (data.type === 'node_done')   { _setNodeStatus(data.step, data.node, 'done');   return; }
    if (data.type === 'node_failed') { _setNodeStatus(data.step, data.node, 'failed'); return; }

    if (data.type === 'finished') {
      es.close(); _eventSource = null;
      document.getElementById('abortDeploy').style.display = 'none';
      const homeBtn = document.getElementById('btnHomeFixed');
      if (homeBtn) homeBtn.style.display = '';
      if (data.success) {
        clusterDeployed = true;
        document.getElementById('deployTitle').textContent    = 'Cluster Deployed';
        document.getElementById('deploySubtitle').textContent = 'All steps completed successfully';
        document.getElementById('uninstallCluster').style.display = '';
        showToast('K3s cluster deployed successfully!', 5000);

        // Show kubeconfig panel if content was returned
        if (data.kubeconfig) {
          const panel   = document.getElementById('kubeconfigPanel');
          const pre     = document.getElementById('kubeconfigContent');
          const copyBtn = document.getElementById('copyKubeconfig');
          const label   = document.getElementById('copyKubeconfigLabel');
          if (pre) pre.textContent = data.kubeconfig;
          if (panel) panel.style.display = '';
          if (copyBtn) {
            copyBtn.onclick = () => {
              navigator.clipboard.writeText(data.kubeconfig).then(() => {
                if (label) { label.textContent = 'Copied!'; setTimeout(() => { label.textContent = 'Copy'; }, 2000); }
              }).catch(() => showToast('Copy failed — select and copy manually.'));
            };
          }
        }
      } else if (data.aborted) {
        document.getElementById('deployTitle').textContent    = 'Deployment Aborted';
        document.getElementById('deploySubtitle').textContent = 'The process was cancelled by the user';
        document.getElementById('redeployCluster').style.display = '';
        _phaseSteps.forEach(s => { const el = document.getElementById(`dps-${s.id}`); if (el && !el.classList.contains('dps-step--done') && !el.classList.contains('dps-step--failed')) _setPhaseState(s.id, 'aborted'); });
      } else {
        document.getElementById('deployTitle').textContent    = 'Deployment Failed';
        document.getElementById('deploySubtitle').textContent = 'Check the step that failed for details';
        document.getElementById('redeployCluster').style.display = '';
        _phaseSteps.forEach(s => { const el = document.getElementById(`dps-${s.id}`); if (el && el.classList.contains('dps-step--pending')) _setPhaseState(s.id, 'aborted'); });
      }
      return;
    }

    if (data.type === 'error') {
      es.close(); _eventSource = null;
      showToast((data.msg || 'Unknown error'), 5000);
      document.getElementById('abortDeploy').style.display     = 'none';
      document.getElementById('redeployCluster').style.display = '';
      document.getElementById('deployTitle').textContent    = 'Error';
      document.getElementById('deploySubtitle').textContent = data.msg || '';
      const homeBtn = document.getElementById('btnHomeFixed');
      if (homeBtn) homeBtn.style.display = '';
    }
  };

  es.onerror = () => {
    es.close(); _eventSource = null;
    const title = document.getElementById('deployTitle')?.textContent || '';
    if (!title.includes('✅') && !title.includes('❌') && !title.includes('⛔')) {
      document.getElementById('abortDeploy').style.display     = 'none';
      document.getElementById('redeployCluster').style.display = '';
      document.getElementById('deployTitle').textContent    = '❌ Connection Lost';
      document.getElementById('deploySubtitle').textContent = 'The SSE stream was interrupted';
      const homeBtn = document.getElementById('btnHomeFixed');
      if (homeBtn) homeBtn.style.display = '';
    }
  };
}

function abortDeploy() {
  showConfirmToast('Abort the running deployment?', async () => {
    try { await fetch('/deploy-abort', { method: 'POST' }); }
    catch(e) { showToast('Failed to send abort signal'); }
  });
}

function startUninstall() {
  if (!allConnectionsPass) {
    showToast('⚠️ All node connections must pass before you can uninstall.', 4000);
    return;
  }
  const { username, sshKey } = _getSSHCreds();
  if (!username || !sshKey) {
    showToast('⚠️ SSH credentials from the connection tab are required.', 4000);
    return;
  }
  showConfirmToast('Uninstall the K3s cluster from all nodes?', () => {
    _showUninstallRunning();
    const container = document.getElementById('uninstallSteps');
    container.innerHTML = '<div style="color:rgba(255,255,255,0.5);text-align:center;">Connecting…</div>';

    const params = new URLSearchParams({ username, ssh_key: sshKey });
    const es = new EventSource(`/uninstall?${params.toString()}`);
    _eventSource = es;

    es.onmessage = (ev) => {
      let data; try { data = JSON.parse(ev.data); } catch { return; }
      if (data.type === 'steps')      { _renderDeployCanvas(container, data.steps, true); return; }
      if (data.type === 'step_start')  { _setPhaseState(data.step, 'active'); return; }
      if (data.type === 'step_done')   { _setPhaseState(data.step, 'done'); return; }
      if (data.type === 'step_failed') { _setPhaseState(data.step, 'failed'); return; }
      if (data.type === 'node_start')  { _setNodeStatus(data.step, data.node, 'active'); return; }
      if (data.type === 'node_done')   { _setNodeStatus(data.step, data.node, 'done');   return; }
      if (data.type === 'node_failed') { _setNodeStatus(data.step, data.node, 'failed'); return; }

      if (data.type === 'finished') {
        es.close(); _eventSource = null;
        document.getElementById('abortUninstall').style.display = 'none';
        const homeBtn = document.getElementById('btnHomeFixed');
        if (homeBtn) homeBtn.style.display = '';
        if (data.success) {
          clusterDeployed = false;
          document.getElementById('uninstallTitle').textContent    = '✅ Cluster Uninstalled';
          document.getElementById('uninstallSubtitle').textContent = 'All nodes cleaned up successfully';
          showToast('Cluster uninstalled.', 4000);
          setTimeout(() => { _showDeployIdle(); }, 2500);
        } else if (data.aborted) {
          document.getElementById('uninstallTitle').textContent    = '⛔ Uninstall Aborted';
          document.getElementById('uninstallSubtitle').textContent = 'Cancelled by user';
          _phaseSteps.forEach(s => { const el = document.getElementById(`dps-${s.id}`); if (el && !el.classList.contains('dps-step--done') && !el.classList.contains('dps-step--failed')) _setPhaseState(s.id, 'aborted'); });
          setTimeout(() => {
            document.getElementById('deployRunning').style.display    = '';
            document.getElementById('uninstallRunning').style.display = 'none';
          }, 2500);
        } else {
          document.getElementById('uninstallTitle').textContent    = '❌ Uninstall Failed';
          document.getElementById('uninstallSubtitle').textContent = 'Check the step that failed';
          _phaseSteps.forEach(s => { const el = document.getElementById(`dps-${s.id}`); if (el && el.classList.contains('dps-step--pending')) _setPhaseState(s.id, 'aborted'); });
        }
        return;
      }

      if (data.type === 'error') {
        es.close(); _eventSource = null;
        showToast('❌ ' + (data.msg || 'Unknown error'), 5000);
        document.getElementById('abortUninstall').style.display  = 'none';
        document.getElementById('uninstallTitle').textContent    = '❌ Error';
        document.getElementById('uninstallSubtitle').textContent = data.msg || '';
        const homeBtn = document.getElementById('btnHomeFixed');
        if (homeBtn) homeBtn.style.display = '';
      }
    };

    es.onerror = () => {
      es.close(); _eventSource = null;
      const title = document.getElementById('uninstallTitle')?.textContent || '';
      if (!title.includes('✅') && !title.includes('❌') && !title.includes('⛔')) {
        document.getElementById('abortUninstall').style.display  = 'none';
        document.getElementById('uninstallTitle').textContent    = '❌ Connection Lost';
        document.getElementById('uninstallSubtitle').textContent = 'The SSE stream was interrupted';
        const homeBtn = document.getElementById('btnHomeFixed');
        if (homeBtn) homeBtn.style.display = '';
      }
    };
  });
}
