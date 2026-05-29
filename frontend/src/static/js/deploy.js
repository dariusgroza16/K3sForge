// ── Deploy / Uninstall ────────────────────────────────────────────────

const STEP_ICONS = {
  docker: '🐳', primordial: '👑', kubeconfig: '🔑', masters: '🖥️', workers: '⚙️',
  pre_tasks: '🧹',
};
const DONE_ICON = '✓';
const FAIL_ICON = '✕';

const STEP_DESCRIPTIONS = {
  pre_tasks:  'Preparing all nodes for installation',
  docker:     'Installing container runtime on all nodes',
  primordial: 'Bootstrapping the primary control plane',
  kubeconfig: 'Retrieving cluster credentials',
  masters:    'Joining additional control plane nodes',
  workers:    'Joining worker nodes to the cluster',
};

const UNINSTALL_DESCRIPTIONS = {
  workers:    'Removing K3s from worker nodes',
  masters:    'Removing K3s from secondary control plane nodes',
  primordial: 'Removing K3s from the primary master',
  kubeconfig: 'Cleaning up local cluster credentials',
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

function _renderTimeline(container, steps, isUninstall) {
  _nodeStatuses = {};
  container.innerHTML = '';
  const descs = isUninstall ? UNINSTALL_DESCRIPTIONS : STEP_DESCRIPTIONS;
  const tl = document.createElement('div');
  tl.className = 'tl';
  steps.forEach((s, idx) => {
    _nodeStatuses[s.id] = {};
    const isLast = idx === steps.length - 1;
    const phase = document.createElement('div');
    phase.className = 'tl-phase';
    phase.id = `phase-${s.id}`;
    phase.dataset.state = 'pending';
    phase.innerHTML = `
      <div class="tl-connector">
        <div class="tl-dot"></div>
        ${!isLast ? '<div class="tl-line"></div>' : ''}
      </div>
      <div class="tl-body">
        <div class="tl-header">
          <span class="tl-icon">${STEP_ICONS[s.id] || '📦'}</span>
          <div class="tl-text">
            <span class="tl-name">${escapeHtml(s.label)}</span>
            <span class="tl-desc">${escapeHtml(descs[s.id] || '')}</span>
          </div>
          <span class="tl-badge"></span>
        </div>
        <div class="tl-nodes" id="nodes-${s.id}" style="display:none"></div>
      </div>`;
    tl.appendChild(phase);
  });
  container.appendChild(tl);
}

function _setPhaseState(stepId, state) {
  const phase = document.getElementById(`phase-${stepId}`);
  if (!phase) return;
  phase.dataset.state = state;
  const badge = phase.querySelector('.tl-badge');
  if (!badge) return;
  if (state === 'active') {
    badge.innerHTML = '<span class="tl-spinner"></span><span class="tl-badge-text">In progress</span>';
  } else if (state === 'done') {
    badge.innerHTML = '<span class="tl-badge-done">&#10003; Complete</span>';
    const nodes = _nodeStatuses[stepId] || {};
    Object.keys(nodes).forEach(n => { if (nodes[n] !== 'failed') _setNodeStatus(stepId, n, 'done'); });
  } else if (state === 'failed') {
    badge.innerHTML = '<span class="tl-badge-failed">&#10007; Failed</span>';
    const nodes = _nodeStatuses[stepId] || {};
    Object.keys(nodes).forEach(n => { if (nodes[n] === 'active' || nodes[n] === 'pending') _setNodeStatus(stepId, n, 'failed'); });
  } else if (state === 'aborted') {
    badge.innerHTML = '<span class="tl-badge-aborted">&#8856; Aborted</span>';
    const nodes = _nodeStatuses[stepId] || {};
    Object.keys(nodes).forEach(n => { if (nodes[n] !== 'done' && nodes[n] !== 'failed') _setNodeStatus(stepId, n, 'aborted'); });
  } else {
    badge.innerHTML = '';
  }
}

function _setNodeStatus(stepId, nodeName, status) {
  if (!_nodeStatuses[stepId]) _nodeStatuses[stepId] = {};
  _nodeStatuses[stepId][nodeName] = status;
  const nodesContainer = document.getElementById(`nodes-${stepId}`);
  if (!nodesContainer) return;
  nodesContainer.style.display = '';
  let chip = document.getElementById(`chip-${stepId}-${nodeName}`);
  if (!chip) {
    chip = document.createElement('div');
    chip.id = `chip-${stepId}-${nodeName}`;
    nodesContainer.appendChild(chip);
  }
  const icons = { active: '⟳', done: '✓', failed: '✕', aborted: '⊘', pending: '○' };
  chip.className = `tl-chip tl-chip--${status}`;
  chip.textContent = `${icons[status] || '○'} ${nodeName}`;
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
}

function _showUninstallRunning() {
  document.getElementById('deployIdle').style.display       = 'none';
  document.getElementById('deployRunning').style.display    = 'none';
  document.getElementById('uninstallRunning').style.display = '';
  document.getElementById('abortUninstall').style.display   = '';
  document.getElementById('uninstallTitle').textContent    = 'Uninstalling…';
  document.getElementById('uninstallSubtitle').textContent = 'Running the k3s-uninstall playbook';
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
    if (data.type === 'steps')      { _renderTimeline(container, data.steps, false); return; }
    if (data.type === 'step_start')  { _setPhaseState(data.step, 'active'); return; }
    if (data.type === 'step_done')   { _setPhaseState(data.step, 'done'); return; }
    if (data.type === 'step_failed') { _setPhaseState(data.step, 'failed'); return; }
    if (data.type === 'task') {
      if (data.step) {
        const colonIdx = (data.task || '').indexOf(':');
        if (colonIdx > 0) {
          const possibleNode = data.task.slice(0, colonIdx).trim();
          if (possibleNode && !possibleNode.includes(' ')) _setNodeStatus(data.step, possibleNode, 'active');
        }
      }
      return;
    }
    if (data.type === 'log') {
      if (data.node && data.step && !(_nodeStatuses[data.step] || {})[data.node]) _setNodeStatus(data.step, data.node, 'active');
      return;
    }
    if (data.type === 'task_warning') {
      if (data.step) {
        const m = (data.msg || '').match(/^\[([^\]]+)\]/);
        if (m) _setNodeStatus(data.step, m[1], 'failed');
      }
      return;
    }

    if (data.type === 'finished') {
      es.close(); _eventSource = null;
      document.getElementById('abortDeploy').style.display = 'none';
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
        container.querySelectorAll('.tl-phase[data-state="active"], .tl-phase[data-state="pending"]').forEach(p => _setPhaseState(p.id.replace('phase-', ''), 'aborted'));
      } else {
        document.getElementById('deployTitle').textContent    = 'Deployment Failed';
        document.getElementById('deploySubtitle').textContent = 'Check the step that failed for details';
        document.getElementById('redeployCluster').style.display = '';
        container.querySelectorAll('.tl-phase[data-state="pending"]').forEach(p => _setPhaseState(p.id.replace('phase-', ''), 'aborted'));
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
      if (data.type === 'steps')      { _renderTimeline(container, data.steps, true); return; }
      if (data.type === 'step_start')  { _setPhaseState(data.step, 'active'); return; }
      if (data.type === 'step_done')   { _setPhaseState(data.step, 'done'); return; }
      if (data.type === 'step_failed') { _setPhaseState(data.step, 'failed'); return; }
      if (data.type === 'task') {
        if (data.step) {
          const colonIdx = (data.task || '').indexOf(':');
          if (colonIdx > 0) {
            const possibleNode = data.task.slice(0, colonIdx).trim();
            if (possibleNode && !possibleNode.includes(' ')) _setNodeStatus(data.step, possibleNode, 'active');
          }
        }
        return;
      }
      if (data.type === 'log') {
        if (data.node && data.step && !(_nodeStatuses[data.step] || {})[data.node]) _setNodeStatus(data.step, data.node, 'active');
        return;
      }
      if (data.type === 'task_warning') {
        if (data.step) {
          const m = (data.msg || '').match(/^\[([^\]]+)\]/);
          if (m) _setNodeStatus(data.step, m[1], 'failed');
        }
        return;
      }

      if (data.type === 'finished') {
        es.close(); _eventSource = null;
        document.getElementById('abortUninstall').style.display = 'none';
        if (data.success) {
          clusterDeployed = false;
          document.getElementById('uninstallTitle').textContent    = '✅ Cluster Uninstalled';
          document.getElementById('uninstallSubtitle').textContent = 'All nodes cleaned up successfully';
          showToast('Cluster uninstalled.', 4000);
          setTimeout(() => { _showDeployIdle(); }, 2500);
        } else if (data.aborted) {
          document.getElementById('uninstallTitle').textContent    = '⛔ Uninstall Aborted';
          document.getElementById('uninstallSubtitle').textContent = 'Cancelled by user';
          container.querySelectorAll('.tl-phase[data-state="active"], .tl-phase[data-state="pending"]').forEach(p => _setPhaseState(p.id.replace('phase-', ''), 'aborted'));
          setTimeout(() => {
            document.getElementById('deployRunning').style.display    = '';
            document.getElementById('uninstallRunning').style.display = 'none';
          }, 2500);
        } else {
          document.getElementById('uninstallTitle').textContent    = '❌ Uninstall Failed';
          document.getElementById('uninstallSubtitle').textContent = 'Check the step that failed';
          container.querySelectorAll('.tl-phase[data-state="pending"]').forEach(p => _setPhaseState(p.id.replace('phase-', ''), 'aborted'));
        }
        return;
      }

      if (data.type === 'error') {
        es.close(); _eventSource = null;
        showToast('❌ ' + (data.msg || 'Unknown error'), 5000);
        document.getElementById('abortUninstall').style.display  = 'none';
        document.getElementById('uninstallTitle').textContent    = '❌ Error';
        document.getElementById('uninstallSubtitle').textContent = data.msg || '';
      }
    };

    es.onerror = () => {
      es.close(); _eventSource = null;
      const title = document.getElementById('uninstallTitle')?.textContent || '';
      if (!title.includes('✅') && !title.includes('❌') && !title.includes('⛔')) {
        document.getElementById('abortUninstall').style.display  = 'none';
        document.getElementById('uninstallTitle').textContent    = '❌ Connection Lost';
        document.getElementById('uninstallSubtitle').textContent = 'The SSE stream was interrupted';
      }
    };
  });
}
