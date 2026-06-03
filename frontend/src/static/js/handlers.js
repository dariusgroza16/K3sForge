// ── Button / event-handler wiring ────────────────────────────────────

function setupHandlers() {
  console.log('setupHandlers running');

  // ── Tab navigation bubble ──────────────────────────────────────────
  const navList = document.getElementById('navList');
  if (navList) {
    const tabItems = navList.querySelectorAll('li');
    tabItems.forEach((item, index) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        if (item.classList.contains('disabled')) {
          if (index === 1) showToast('⚠️ Please generate or detect an inventory first before testing connections.', 3500);
          else if (index === 2) showToast('⚠️ Please complete connection tests successfully before accessing deployment.', 3500);
          return;
        }
        const tabName = item.getAttribute('data-tab');
        activeTabIndex = index;
        tabItems.forEach(li => li.classList.remove('active'));
        item.classList.add('active');
        switchTab(tabName);
        updateBubblePosition(item);
      });
    });
    // Bubble positioning is deferred to when the container becomes visible (cluster.js).
    updateTabStates();
    window.addEventListener('resize', () => {
      const cur = navList.querySelectorAll('li')[activeTabIndex];
      if (cur) updateBubblePosition(cur);
    });
  }

  // ── Role switch label ──────────────────────────────────────────────
  const roleSwitch = document.getElementById('roleSwitch');
  if (roleSwitch) roleSwitch.addEventListener('change', function () {
    const lbl = document.getElementById('roleLabel');
    if (lbl) lbl.textContent = this.checked ? 'Master' : 'Worker';
  });

  // ── Add VM ─────────────────────────────────────────────────────────
  const addBtn = document.getElementById('addVM');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const nameEl = document.getElementById('vmName');
      const ipEl   = document.getElementById('vmIP');
      if (!nameEl || !ipEl) { console.warn('inputs missing'); return; }
      const name = nameEl.value.trim();
      const ip   = ipEl.value.trim();
      const role = document.getElementById('roleSwitch')?.checked ? 'master' : 'worker';

      // Inline validation
      let valid = true;
      const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
      nameEl.classList.remove('input-error'); setFieldError(nameEl, '');
      ipEl.classList.remove('input-error');   setFieldError(ipEl, '');
      if (!name) {
        nameEl.classList.add('input-error'); setFieldError(nameEl, 'VM name is required');
        valid = false;
      }
      if (!ip) {
        ipEl.classList.add('input-error'); setFieldError(ipEl, 'IP address is required');
        valid = false;
      } else if (!ipPattern.test(ip)) {
        ipEl.classList.add('input-error'); setFieldError(ipEl, 'Enter a valid IPv4 address');
        valid = false;
      }
      if (!valid) return;

      const existingMasters = vms.filter(x => x.role === 'master').length;
      vms.push({ name, ip, role });
      if (role === 'master' && existingMasters === 0) primordialMaster = name;
      nameEl.value = ''; ipEl.value = ''; nameEl.focus();
      renderVMList(); showToast(`${name} added`);
    });
  }

  // ── Generate inventory ─────────────────────────────────────────────
  const gen = document.getElementById('generate');
  if (gen) gen.addEventListener('click', async () => {
    const masters = vms.filter(x => x.role === 'master');
    if (masters.length === 0) { showToast('Add at least one master before generating.'); return; }
    try {
      for (const vmName of deletedVMs) { await deleteHostFile(vmName); }
      deletedVMs = [];
      const res  = await fetch('/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vms, primordialMaster }) });
      let json   = null; try { json = await res.json(); } catch(e) {}
      if (!res.ok) { showToast((json && json.message) ? json.message : 'Generation failed'); return; }
      inventoryExists    = true;
      allConnectionsPass = false;
      updateProceedButton();
      showToast('Inventory files generated!');
      setTimeout(() => { switchToConnectionView(); }, 800);
    } catch(e) { showToast('Network error.'); }
  });

  // ── Proceed to test ────────────────────────────────────────────────
  const proceedBtn = document.getElementById('proceedToTest');
  if (proceedBtn) proceedBtn.addEventListener('click', () => {
    if (!inventoryExists) { showToast('⚠️ Please generate or detect an inventory first before testing connections.', 3500); return; }
    switchToConnectionView();
  });

  // ── Detect / clear inventory ───────────────────────────────────────
  const detectBtn = document.getElementById('detectInventory');
  if (detectBtn) detectBtn.addEventListener('click', async () => { await detectInventory(); });

  const clearBtn = document.getElementById('clearInventory');
  if (clearBtn) clearBtn.addEventListener('click', () => { clearInventory(); });

  // ── Back to inventory ──────────────────────────────────────────────
  const backBtn = document.getElementById('backToInventory');
  if (backBtn) backBtn.addEventListener('click', () => { switchToInventoryView(); });

  // ── Proceed to deploy ──────────────────────────────────────────────
  const proceedToDeployBtn = document.getElementById('proceedToDeploy');
  if (proceedToDeployBtn) proceedToDeployBtn.addEventListener('click', () => { switchTab('deploy'); });

  // ── Test connections ───────────────────────────────────────────────
  const testBtn = document.getElementById('testConnections');
  if (testBtn) testBtn.addEventListener('click', () => { testConnections(); });

  // ── Deploy ─────────────────────────────────────────────────────────
  const startDeployBtn = document.getElementById('startDeploy');
  if (startDeployBtn) startDeployBtn.addEventListener('click', () => {
    if (clusterDeployed) { showToast('⚠️ A cluster is already deployed. Uninstall first before redeploying.', 4000); return; }
    startDeploy();
  });

  const abortDeployBtn = document.getElementById('abortDeploy');
  if (abortDeployBtn) abortDeployBtn.addEventListener('click', () => abortDeploy());

  const redeployBtn = document.getElementById('redeployCluster');
  if (redeployBtn) redeployBtn.addEventListener('click', () => { clusterDeployed = false; _showDeployIdle(); });

  // ── Secret visibility toggles ──────────────────────────────────────
  wireSecretToggle('toggleSshKey', 'sshKey');
  wireSecretToggle('toggleK3sToken', 'k3sToken');
}
