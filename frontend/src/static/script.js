let vms = [];

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
    body: JSON.stringify({ vms })
  });

  const result = await response.json();
  if (result.status === 'success') {
    alert('Inventory files generated!');
  }
});

function deleteVM(index) {
  vms.splice(index, 1);
  renderVMList();
}

function renderVMList() {
  const container = document.getElementById('vmList');
  container.innerHTML = '';

  vms.forEach((vm, index) => {
    const div = document.createElement('div');
    div.className = `vm-entry ${vm.role}`;
    div.innerHTML = `
      <span><strong>${vm.name}</strong> (${vm.ip}) — <em>${vm.role.toUpperCase()}</em></span>
      <button onclick="deleteVM(${index})">Delete</button>
    `;
    container.appendChild(div);
  });
}
