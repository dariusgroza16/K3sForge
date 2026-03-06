// ── Inventory management ──────────────────────────────────────────────

function deleteVM(index) {
  if (index < 0 || index >= vms.length) return;
  const vmName = vms[index].name;
  if (primordialMaster === vmName) primordialMaster = null;
  deletedVMs.push(vmName);
  vms.splice(index, 1);
  renderVMList();
  showToast('Entry removed');
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
  const masters       = vms.filter(vm => vm.role === 'master');
  const multipleMasters = masters.length > 1;

  vms.forEach((vm, index) => {
    const div = document.createElement('div');
    div.className = `vm-entry ${vm.role}`;

    const left  = document.createElement('div');
    const title = document.createElement('span');
    title.innerHTML = `<strong>${escapeHtml(vm.name)}</strong> (${escapeHtml(vm.ip)}) — <em>${vm.role.toUpperCase()}</em>`;
    left.appendChild(title);

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
