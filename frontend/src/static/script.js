let vms = [];
let primordialMaster = null; // Track the unique primordial master

document.getElementById('roleSwitch').addEventListener('change', function () {
  document.getElementById('roleLabel').textContent = this.checked ? 'Master' : 'Worker';
});

document.getElementById('addVM').addEventListener('click', function () {
  const name = document.getElementById('vmName').value.trim();
  const ip = document.getElementById('vmIP').value.trim();
  const role = document.getElementById('roleSwitch').checked ? 'master' : 'worker';

  if (!name || !ip) {
    alert('Please fill out both fields.');
    return;
  }

  vms.push({ name, ip, role });
  renderVMList();

  document.getElementById('vmName').value = '';
  document.getElementById('vmIP').value = '';
});

document.getElementById('generate').addEventListener('click', async function () {
  const response = await fetch('/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vms, primordialMaster })
  });

  const result = await response.json();
  if (result.status === 'success') {
    alert('Inventory files generated!');
  }
});

function deleteVM(index) {
  // If deleting the primordial master, unset it
  if (primordialMaster === vms[index].name) {
    primordialMaster = null;
  }
  vms.splice(index, 1);
  renderVMList();
}

function setPrimordialMaster(name) {
  primordialMaster = name;
  renderVMList();
}

function renderVMList() {
  const container = document.getElementById('vmList');
  container.innerHTML = '';

  vms.forEach((vm, index) => {
    const div = document.createElement('div');
    div.className = `vm-entry ${vm.role}`;
    let primordialHTML = '';
    if (vm.role === 'master') {
      primordialHTML = `
        <label style="margin-left:10px;">
          <input type="radio" name="primordialMaster" ${primordialMaster === vm.name ? 'checked' : ''} onclick="setPrimordialMaster('${vm.name}')">
          Primordial Master
        </label>
      `;
    }
    div.innerHTML = `
      <span><strong>${vm.name}</strong> (${vm.ip}) — <em>${vm.role.toUpperCase()}</em>${primordialHTML}</span>
      <button onclick="deleteVM(${index})">Delete</button>
    `;
    container.appendChild(div);
  });
}

// Expose setPrimordialMaster globally for inline onclick
window.setPrimordialMaster = setPrimordialMaster;
