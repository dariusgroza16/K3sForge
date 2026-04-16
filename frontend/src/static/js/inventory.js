// ── Inventory management ──────────────────────────────────────────────

function deleteVM(index) {
  if (index < 0 || index >= vms.length) return;
  const removed = vms.splice(index, 1)[0];
  if (primordialMaster === removed.name) primordialMaster = null;
  renderVMList();

  // Show undo toast — user has 4 s to cancel
  const t = document.getElementById('toast');
  if (!t) return;
  let undone = false;
  t.innerHTML = `<span>${escapeHtml(removed.name)} removed</span><button id="toast-undo" style="margin-left:12px;padding:5px 10px;background:rgba(255,255,255,0.12);color:#fff;border:1px solid rgba(255,255,255,0.25);border-radius:6px;cursor:pointer;font-size:0.82rem;">Undo</button>`;
  t.classList.add('show');
  t.setAttribute('aria-hidden', 'false');
  clearTimeout(t._timer);

  const undoBtn = document.getElementById('toast-undo');
  if (undoBtn) {
    undoBtn.addEventListener('click', () => {
      undone = true;
      vms.splice(index, 0, removed);
      if (removed.role === 'master' && !primordialMaster) primordialMaster = removed.name;
      renderVMList();
      t.classList.remove('show');
      t.setAttribute('aria-hidden', 'true');
      setTimeout(() => { t.innerHTML = ''; }, 300);
    });
  }

  t._timer = setTimeout(() => {
    if (!undone) deletedVMs.push(removed.name);
    t.classList.remove('show');
    t.setAttribute('aria-hidden', 'true');
    setTimeout(() => { t.innerHTML = ''; }, 300);
  }, 4000);
}

async function deleteHostFile(name) {
  try {
    await fetch('/delete-host', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } catch(e) {
    console.error('Failed to delete host file:', e);
  }
}

async function detectInventory() {
  if (vms.length > 0) {
    showConfirmToast('This will overwrite current VMs. Continue?', async () => {
      await loadInventory();
    }, () => {
      showToast('Detection cancelled');
    });
  } else {
    await loadInventory();
  }
}

async function loadInventory() {
  try {
    const res  = await fetch('/detect-inventory');
    const json = await res.json();
    if (!res.ok) { showToast(json.message || 'No inventory found'); return; }
    vms = json.vms || [];
    primordialMaster = json.primordial_master || null;
    deletedVMs = [];
    inventoryExists = true;
    allConnectionsPass = false;
    updateProceedButton();
    renderVMList();
    showToast(`Loaded ${vms.length} VM(s) from inventory`);
  } catch(e) {
    showToast('Failed to detect inventory');
    console.error('Detect error:', e);
  }
}

function clearInventory() {
  if (vms.length === 0) { showToast('No entries to clear'); return; }
  showConfirmToast('Clear all VM entries from the browser? (Files will not be deleted)', () => {
    vms = [];
    primordialMaster = null;
    deletedVMs = [];
    inventoryExists = false;
    allConnectionsPass = false;
    updateProceedButton();
    renderVMList();
    showToast('Entries cleared');
  }, () => {
    showToast('Clear cancelled');
  });
}

function setPrimordialMaster(name) {
  primordialMaster = name;
  renderVMList();
  showToast(`${name} set as primordial master`);
}

function updateGenerateState() {
  const btn = document.getElementById('generate');
  if (!btn) return;
  const masters = vms.filter(x => x.role === 'master');
  if (masters.length === 0) {
    btn.setAttribute('aria-disabled', 'true');
    btn.classList.add('disabled');
  } else {
    btn.setAttribute('aria-disabled', 'false');
    btn.classList.remove('disabled');
  }
  updateProceedButton();
}

function renderVMList() {
  const container = document.getElementById('vmList');
  if (!container) return;
  container.innerHTML = '';

  if (vms.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vm-list-empty';
    empty.innerHTML = `<span class="vm-list-empty-icon">🖥️</span><p>No VMs added yet</p><span>Fill in a VM name and IP above, then click <strong>Add VM</strong></span>`;
    container.appendChild(empty);
    updateGenerateState();
    renderTopology();
    return;
  }

  const masters       = vms.filter(vm => vm.role === 'master');
  const multipleMasters = masters.length > 1;

  vms.forEach((vm, index) => {
    const div = document.createElement('div');
    div.className = `vm-entry ${vm.role}`;

    const left  = document.createElement('div');
    left.style.display = 'flex';
    left.style.flexDirection = 'column';
    left.style.gap = '4px';

    // Role badge + name row
    const nameRow = document.createElement('div');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    nameRow.style.gap = '8px';

    const roleBadge = document.createElement('span');
    roleBadge.className = `vm-role-badge vm-role-badge--${vm.role}`;
    roleBadge.textContent = vm.role.toUpperCase();
    nameRow.appendChild(roleBadge);

    const title = document.createElement('span');
    title.innerHTML = `<strong>${escapeHtml(vm.name)}</strong> <span style="color:rgba(255,255,255,0.5);font-size:0.85rem">${escapeHtml(vm.ip)}</span>`;
    nameRow.appendChild(title);
    left.appendChild(nameRow);

    if (vm.role === 'master') {
      const label = document.createElement('label');
      label.className = 'primordial-selector';
      if (multipleMasters) {
        const radioWrapper = document.createElement('span');
        radioWrapper.className = 'custom-radio';
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'primordialMaster';
        radio.checked = primordialMaster === vm.name;
        radio.addEventListener('click', () => setPrimordialMaster(vm.name));
        const checkmark = document.createElement('span');
        checkmark.className = 'radio-checkmark';
        radioWrapper.appendChild(radio);
        radioWrapper.appendChild(checkmark);
        label.appendChild(radioWrapper);
        const labelText = document.createElement('span');
        labelText.textContent = 'Primordial Master';
        labelText.className = 'primordial-label';
        label.appendChild(labelText);
      } else {
        const badge = document.createElement('span');
        badge.textContent = 'Primordial Master';
        badge.className = 'primordial-badge-auto';
        label.appendChild(badge);
      }
      left.appendChild(label);
    }

    const rightBtn = document.createElement('button');
    rightBtn.textContent = 'Delete';
    rightBtn.addEventListener('click', () => deleteVM(index));
    div.appendChild(left);
    div.appendChild(rightBtn);
    container.appendChild(div);
  });

  updateGenerateState();
  renderTopology();
}
