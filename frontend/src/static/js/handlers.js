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
    const activeLi = tabItems[activeTabIndex];
    if (activeLi) setTimeout(() => updateBubblePosition(activeLi), 50);
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
      if (!name || !ip) { showToast('Please fill out both VM name and IP.'); return; }
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

  const uninstallBtn = document.getElementById('uninstallCluster');
  if (uninstallBtn) uninstallBtn.addEventListener('click', () => startUninstall());

  const redeployBtn = document.getElementById('redeployCluster');
  if (redeployBtn) redeployBtn.addEventListener('click', () => { clusterDeployed = false; _showDeployIdle(); });

  const abortUninstallBtn = document.getElementById('abortUninstall');
  if (abortUninstallBtn) abortUninstallBtn.addEventListener('click', () => {
    showConfirmToast('Abort the running uninstall?', async () => {
      try { await fetch('/deploy-abort', { method: 'POST' }); } catch(e) { showToast('Failed to abort'); }
    });
  });

  // ── Download topology ──────────────────────────────────────────────
  const dl = document.getElementById('downloadTopo');
  if (dl) dl.addEventListener('click', () => {
    const container = document.getElementById('topology'); if (!container) { showToast('Nothing to download'); return; }
    const svg = container.querySelector('svg');            if (!svg)       { showToast('Nothing to download'); return; }
    const clone = svg.cloneNode(true);
    const masters = vms.filter(n => n.role === 'master');
    const workers = vms.filter(n => n.role === 'worker');
    const masterRectW = 220; const minMasterSpacing = 50;
    const minWidthForMasters = masters.length * (masterRectW + minMasterSpacing) + minMasterSpacing;
    const workerRectW = 200; const minWorkerSpacing = 50;
    const minWidthForWorkers = workers.length > 0 ? workers.length * (workerRectW + minWorkerSpacing) + minWorkerSpacing : 0;
    const w = Math.max(container.clientWidth || 900, minWidthForMasters, minWidthForWorkers);
    const h = Math.max(240, Math.floor((vms.length + 1) * 40));
    clone.setAttribute('width', w); clone.setAttribute('height', h); clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const s    = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([s], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const png = canvas.toDataURL('image/png');
      const a   = document.createElement('a'); a.href = png; a.download = 'k3s-topology.png';
      document.body.appendChild(a); a.click(); a.remove();
    };
    img.onerror = () => { showToast('Failed to render image'); URL.revokeObjectURL(url); };
    img.src = url;
  });
}
