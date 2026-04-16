// ── Deploy / Uninstall ────────────────────────────────────────────────

const STEP_ICONS = {
  docker: '🐳', primordial: '👑', kubeconfig: '🔑', masters: '🖥️', workers: '⚙️',
  pre_tasks: '🧹',
};
const DONE_ICON = '✓';
const FAIL_ICON = '✕';

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

function _renderStepCards(container, steps) {
  container.innerHTML = '';
  steps.forEach(s => {
    const card = document.createElement('div');
    card.className = 'step-card pending';
    card.id = `step-${s.id}`;
    card.innerHTML = `<div class="step-icon">${STEP_ICONS[s.id] || '📦'}</div><div class="step-label">${escapeHtml(s.label)}</div><div class="step-task"></div>`;
    container.appendChild(card);
  });
}

function _setCardState(stepId, state, taskText) {
  const card = document.getElementById(`step-${stepId}`);
  if (!card) return;
  card.className = `step-card ${state}`;
  const icon = card.querySelector('.step-icon');
  if (state === 'done'   && icon) icon.textContent = DONE_ICON;
  if (state === 'failed' && icon) icon.textContent = FAIL_ICON;
  if (taskText !== undefined) {
    const taskEl = card.querySelector('.step-task');
    if (taskEl) taskEl.textContent = taskText;
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
    if (data.type === 'steps')        { _renderStepCards(container, data.steps); return; }
    if (data.type === 'step_start')   { _setCardState(data.step, 'active', ''); return; }
    if (data.type === 'step_done')    { _setCardState(data.step, 'done'); return; }
    if (data.type === 'task')         { _setCardState(data.step, 'active', data.task); return; }
    if (data.type === 'log')          { if (data.step) _setCardState(data.step, 'active', (data.msg || '').slice(0, 80)); return; }
    if (data.type === 'task_warning') { _setCardState(data.step, 'active', '⚠ ' + (data.msg || '').slice(0, 80)); return; }
    if (data.type === 'step_failed')  { _setCardState(data.step, 'failed', 'Failed'); return; }

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
        container.querySelectorAll('.step-card.active, .step-card.pending').forEach(c => c.className = 'step-card aborted');
      } else {
        document.getElementById('deployTitle').textContent    = 'Deployment Failed';
        document.getElementById('deploySubtitle').textContent = 'Check the step that failed for details';
        document.getElementById('redeployCluster').style.display = '';
        container.querySelectorAll('.step-card.pending').forEach(c => c.className = 'step-card aborted');
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
      if (data.type === 'steps')        { _renderStepCards(container, data.steps); return; }
      if (data.type === 'step_start')   { _setCardState(data.step, 'active', ''); return; }
      if (data.type === 'step_done')    { _setCardState(data.step, 'done'); return; }
      if (data.type === 'task')         { _setCardState(data.step, 'active', data.task); return; }
      if (data.type === 'task_warning') { _setCardState(data.step, 'active', '⚠ ' + (data.msg || '').slice(0, 80)); return; }
      if (data.type === 'step_failed')  { _setCardState(data.step, 'failed', 'Failed'); return; }

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
          container.querySelectorAll('.step-card.active, .step-card.pending').forEach(c => c.className = 'step-card aborted');
          setTimeout(() => {
            document.getElementById('deployRunning').style.display    = '';
            document.getElementById('uninstallRunning').style.display = 'none';
          }, 2500);
        } else {
          document.getElementById('uninstallTitle').textContent    = '❌ Uninstall Failed';
          document.getElementById('uninstallSubtitle').textContent = 'Check the step that failed';
          container.querySelectorAll('.step-card.pending').forEach(c => c.className = 'step-card aborted');
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
