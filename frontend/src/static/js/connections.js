// ── SSH connection testing ────────────────────────────────────────────

async function testConnections() {
  const username = document.getElementById('sshUsername')?.value.trim();
  const sshKey   = document.getElementById('sshKey')?.value.trim();
  if (!username || !sshKey) { showToast('Please provide SSH username and private key'); return; }

  const resultsSection = document.getElementById('connectionResults');
  const connectionList = document.getElementById('connectionList');
  if (!resultsSection || !connectionList) return;

  resultsSection.style.display = 'block';
  connectionList.innerHTML = '';
  allConnectionsPass = false;
  updateTabStates();

  vms.forEach(vm => {
    const item = document.createElement('div');
    item.className = 'connection-item';
    item.id = `conn-${vm.name}`;
    item.innerHTML = `<div class="connection-info"><div class="connection-status loading"></div><div class="connection-details"><div class="connection-name">${escapeHtml(vm.name)}</div><div class="connection-ip">${escapeHtml(vm.ip)}</div><div class="connection-message">Testing connection...</div></div></div>`;
    connectionList.appendChild(item);
  });

  let allPassed = true;
  for (const vm of vms) {
    const passed = await testSingleConnection(vm.name, vm.ip, username, sshKey);
    if (!passed) allPassed = false;
  }

  if (allPassed && vms.length > 0) {
    allConnectionsPass = true;
    updateTabStates();
    showToast('All connections passed! Deploy tab is now available.', 4000);
  }
}

async function testSingleConnection(name, ip, username, sshKey, isRetry = false) {
  const item = document.getElementById(`conn-${name}`);
  if (!item) return false;

  const statusEl  = item.querySelector('.connection-status');
  const messageEl = item.querySelector('.connection-message');
  const actionsEl = item.querySelector('.connection-actions');
  if (actionsEl) actionsEl.remove();
  if (statusEl)  { statusEl.className = 'connection-status loading'; statusEl.textContent = ''; }
  if (messageEl) messageEl.textContent = 'Testing connection...';

  const addRetry = () => {
    const actions  = document.createElement('div');
    actions.className = 'connection-actions';
    const retryBtn = document.createElement('button');
    retryBtn.className = 'retry-btn'; retryBtn.textContent = '🔄 Retry';
    retryBtn.addEventListener('click', async () => {
      retryBtn.disabled = true;
      await testSingleConnection(name, ip, username, sshKey, true);
      retryBtn.disabled = false;
    });
    actions.appendChild(retryBtn);
    item.appendChild(actions);
  };

  try {
    const res  = await fetch('/test-ssh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ip, username, ssh_key: sshKey }),
    });
    const json = await res.json();
    if (res.ok && json.status === 'success') {
      if (statusEl)  { statusEl.className = 'connection-status success'; statusEl.textContent = '✓'; }
      if (messageEl) messageEl.textContent = json.message || 'Connection successful';
      return true;
    } else {
      if (statusEl)  { statusEl.className = 'connection-status failure'; statusEl.textContent = '✕'; }
      if (messageEl) messageEl.textContent = json.message || 'Connection failed';
      addRetry();
      return false;
    }
  } catch(e) {
    if (statusEl)  { statusEl.className = 'connection-status failure'; statusEl.textContent = '✕'; }
    if (messageEl) messageEl.textContent = 'Network error during test';
    addRetry();
    return false;
  }
}
