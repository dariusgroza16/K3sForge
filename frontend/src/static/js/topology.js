// ── Topology diagram ──────────────────────────────────────────────────

function renderTopology() {
  const container = document.getElementById('topology');
  if (!container) return;
  container.innerHTML = '';

  const baseWidth = container.clientWidth || 800;
  const masters   = vms.filter(n => n.role === 'master');
  const workers   = vms.filter(n => n.role === 'worker');
  const mCount    = Math.max(1, masters.length);
  const wCount    = Math.max(0, workers.length);

  const masterRectW = 220; const minMasterSpacing = 50;
  const minWidthForMasters = mCount * (masterRectW + minMasterSpacing) + minMasterSpacing;
  const workerRectW = 200; const minWorkerSpacing = 50;
  const minWidthForWorkers = wCount > 0 ? wCount * (workerRectW + minWorkerSpacing) + minWorkerSpacing : 0;
  const width  = Math.max(baseWidth, minWidthForMasters, minWidthForWorkers);
  const height = Math.max(240, Math.floor((vms.length + 1) * 40));

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg   = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('xmlns', svgNS);

  const topY = 60; const botY = height - 60;
  function nodeX(i, count) { return Math.round((i + 1) * (width / (count + 1))); }

  const defs   = document.createElementNS(svgNS, 'defs');
  const marker = document.createElementNS(svgNS, 'marker');
  marker.setAttribute('id', 'arrow'); marker.setAttribute('markerUnits', 'strokeWidth');
  marker.setAttribute('markerWidth', '10'); marker.setAttribute('markerHeight', '10');
  marker.setAttribute('refX', '8'); marker.setAttribute('refY', '4'); marker.setAttribute('orient', 'auto');
  const mpath = document.createElementNS(svgNS, 'path');
  mpath.setAttribute('d', 'M0,0 L0,8 L10,4 z'); mpath.setAttribute('fill', '#ffffff');
  marker.appendChild(mpath); defs.appendChild(marker); svg.appendChild(defs);

  masters.forEach((m, i) => {
    const x = nodeX(i, mCount);
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('data-name', m.name); g.setAttribute('data-ip', m.ip);
    g.setAttribute('data-role', 'master'); g.setAttribute('class', 'topo-node');
    const rectW = masterRectW; const rectH = 58; const rxX = x - rectW / 2;
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', rxX); rect.setAttribute('y', topY - rectH / 2);
    rect.setAttribute('width', rectW); rect.setAttribute('height', rectH);
    rect.setAttribute('fill', 'rgba(255,255,255,0.08)'); rect.setAttribute('stroke', '#6366f1');
    rect.setAttribute('stroke-width', '2'); rect.setAttribute('rx', 8); rect.setAttribute('ry', 8);
    g.appendChild(rect);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x); label.setAttribute('y', topY - 6);
    label.setAttribute('fill', '#ffffff'); label.setAttribute('font-size', '16');
    label.setAttribute('font-weight', '700'); label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle'); label.textContent = m.name;
    g.appendChild(label);
    const sub = document.createElementNS(svgNS, 'text');
    sub.setAttribute('x', x); sub.setAttribute('y', topY + 12);
    sub.setAttribute('fill', '#ddd'); sub.setAttribute('font-size', '13');
    sub.setAttribute('text-anchor', 'middle'); sub.setAttribute('dominant-baseline', 'middle');
    sub.textContent = `${m.ip} • MASTER`;
    g.appendChild(sub);
    g.addEventListener('click',      () => showTopoInfo(m.name, m.ip, 'master', x, topY - rectH / 2));
    g.addEventListener('dblclick',   () => openTopoEditor(m.name));
    g.addEventListener('mouseenter', () => g.classList.add('highlight'));
    g.addEventListener('mouseleave', () => g.classList.remove('highlight'));
    svg.appendChild(g);
  });

  workers.forEach((w, i) => {
    const x = nodeX(i, Math.max(1, wCount));
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', 'topo-node'); g.setAttribute('data-name', w.name);
    g.setAttribute('data-ip', w.ip); g.setAttribute('data-role', 'worker');
    const rectW = 200; const rectH = 46; const rxX = x - rectW / 2;
    const rect = document.createElementNS(svgNS, 'rect');
    rect.setAttribute('x', rxX); rect.setAttribute('y', botY - rectH / 2);
    rect.setAttribute('width', rectW); rect.setAttribute('height', rectH);
    rect.setAttribute('fill', 'rgba(255,255,255,0.08)'); rect.setAttribute('stroke', '#ffffff');
    rect.setAttribute('stroke-width', '1.6'); rect.setAttribute('rx', 6); rect.setAttribute('ry', 6);
    g.appendChild(rect);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x); label.setAttribute('y', botY - 4);
    label.setAttribute('fill', '#ffffff'); label.setAttribute('font-size', '14');
    label.setAttribute('text-anchor', 'middle'); label.setAttribute('dominant-baseline', 'middle');
    label.textContent = w.name;
    g.appendChild(label);
    const sub = document.createElementNS(svgNS, 'text');
    sub.setAttribute('x', x); sub.setAttribute('y', botY + 12);
    sub.setAttribute('fill', '#ddd'); sub.setAttribute('font-size', '12');
    sub.setAttribute('text-anchor', 'middle'); sub.setAttribute('dominant-baseline', 'middle');
    sub.textContent = `${w.ip} • WORKER`;
    g.appendChild(sub);
    g.addEventListener('click',      () => showTopoInfo(w.name, w.ip, 'worker', x, botY - rectH / 2));
    g.addEventListener('dblclick',   () => openTopoEditor(w.name));
    g.addEventListener('mouseenter', () => g.classList.add('highlight'));
    g.addEventListener('mouseleave', () => g.classList.remove('highlight'));
    svg.appendChild(g);

    const primName  = primordialMaster;
    const primIndex = masters.findIndex(mm => mm.name === primName);
    const primX  = primIndex >= 0 ? nodeX(primIndex, mCount) : nodeX(0, mCount);
    const startX = x; const startY = botY - rectH / 2;
    const endX   = primX; const endY = topY + 20;
    const midY   = (startY + endY) / 2;
    const line   = document.createElementNS(svgNS, 'path');
    const d      = `M ${startX} ${startY} C ${startX} ${midY} ${endX} ${midY} ${endX} ${endY}`;
    line.setAttribute('d', d); line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#ffffff'); line.setAttribute('stroke-width', '1.8');
    line.setAttribute('stroke-linecap', 'round'); line.setAttribute('marker-end', 'url(#arrow)');
    svg.appendChild(line);
  });

  if (masters.length > 1) {
    for (let i = 0; i < masters.length - 1; i++) {
      const x1 = nodeX(i, mCount); const x2 = nodeX(i + 1, mCount);
      const y  = topY + 30;
      const link = document.createElementNS(svgNS, 'path');
      const d    = `M ${x1} ${y} C ${x1} ${y + 36} ${x2} ${y + 36} ${x2} ${y}`;
      link.setAttribute('d', d); link.setAttribute('stroke', '#6366f1');
      link.setAttribute('stroke-width', '2'); link.setAttribute('fill', 'none');
      link.setAttribute('class', 'topo-link master-link');
      svg.appendChild(link);
    }
  }
  container.appendChild(svg);
}

function showTopoInfo(name, ip, role, x, y) {
  const info = document.getElementById('topoInfo');
  if (!info) return;
  info.innerHTML = `<strong>${escapeHtml(name)}</strong><div class="topo-sub">${escapeHtml(ip)} • ${escapeHtml(role.toUpperCase())}</div>`;
  info.style.left = 'auto'; info.style.right = '18px'; info.style.top = `${Math.max(12, y)}px`;
  info.classList.add('show'); info.setAttribute('aria-hidden', 'false');
  clearTimeout(info._hide);
  info._hide = setTimeout(() => {
    info.classList.remove('show'); info.setAttribute('aria-hidden', 'true');
  }, 4500);
}

function openTopoEditor(name) {
  const node = vms.find(n => n.name === name);
  if (!node) return;
  const container = document.getElementById('topology');
  if (!container) return;
  const svg = container.querySelector('svg');
  if (!svg) return;
  const existing = document.querySelector('.floating-editor');
  if (existing) existing.remove();
  const bboxNode = Array.from(svg.querySelectorAll('g')).find(g => g.getAttribute('data-name') === name);
  if (!bboxNode) return;
  const bbox    = bboxNode.getBBox();
  const svgRect = svg.getBoundingClientRect();
  const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number) || [0, 0, svgRect.width, svgRect.height];
  const vbW = viewBox[2] || svgRect.width; const vbH = viewBox[3] || svgRect.height;
  const scaleX = svgRect.width / vbW; const scaleY = svgRect.height / vbH;
  const clientX = Math.round(svgRect.left + bbox.x * scaleX + window.scrollX);
  const clientY = Math.round(svgRect.top  + bbox.y * scaleY + window.scrollY);
  const clientW = Math.round(bbox.width  * scaleX);
  const clientH = Math.round(bbox.height * scaleY);

  const editor = document.createElement('div');
  editor.className = 'floating-editor inline-editor-fo';
  editor.style.position = 'absolute'; editor.style.zIndex = 99999; editor.style.pointerEvents = 'auto';
  const effectiveWidth  = Math.min(320, Math.max(280, Math.round(Math.min(window.innerWidth - 48, svgRect.width * 0.5))));
  const effectiveHeight = Math.max(180, Math.round(Math.min(300, svgRect.height * 0.5)));
  const viewportWidth   = window.innerWidth + window.scrollX;
  let px = clientX + clientW + 12; let py = clientY;
  if (px + effectiveWidth > viewportWidth - 12) {
    const leftX = clientX - effectiveWidth - 12;
    if (leftX >= window.scrollX + 12) {
      px = leftX;
    } else {
      px = Math.round(clientX + clientW / 2 - effectiveWidth / 2);
      if (px < window.scrollX + 12) px = window.scrollX + 12;
      if (px + effectiveWidth > viewportWidth - 12) px = viewportWidth - effectiveWidth - 12;
      py = clientY + clientH + 12;
    }
  }
  const currentViewportBottom = window.scrollY + window.innerHeight;
  if (py + effectiveHeight > currentViewportBottom - 12) {
    py = Math.max(window.scrollY + 12, py - effectiveHeight - clientH - 24);
    if (py < window.scrollY + 12) py = window.scrollY + 12;
  }
  editor.style.left = px + 'px'; editor.style.top = py + 'px';
  editor.style.width = effectiveWidth + 'px'; editor.style.minHeight = effectiveHeight + 'px';
  editor.innerHTML = `<div style="position:relative; background:#0b0b0b; padding:10px 12px 12px 12px; padding-top:34px; border-radius:8px; border:1px solid #6366f1; box-shadow:0 14px 40px rgba(0,0,0,0.6);"> <button id="__fe_close" aria-label="Close" style="position:absolute; right:8px; top:8px; background:transparent; border:none; color:#fff; font-size:20px; opacity:0.9; cursor:pointer; padding:2px 6px;">×</button> <div style="margin-bottom:8px;"><input id="__fe_name" class="svg-fo-input" placeholder="Name" value="${escapeHtml(node.name)}"></div> <div style="margin-bottom:8px;"><input id="__fe_ip" class="svg-fo-input" placeholder="IP" value="${escapeHtml(node.ip)}"></div> <div style="margin-bottom:12px; display:flex; align-items:center; gap:10px; color:#fff;"><label class="switch"><input type="checkbox" id="__fe_roleswitch" ${node.role === 'master' ? 'checked' : ''}><span class="slider"></span></label><span id="__fe_rolelabel">${node.role === 'master' ? 'Master' : 'Worker'}</span></div> <div class="svg-fo-actions"><button id="__fe_save" class="primary" style="padding:6px 12px;">Save</button> <button id="__fe_cancel" style="padding:6px 10px; background:transparent; border:1px solid rgba(255,255,255,0.06); color:#fff; border-radius:6px;">Cancel</button></div> </div>`;
  document.body.appendChild(editor);
  requestAnimationFrame(() => editor.classList.add('show'));

  const nameIn     = editor.querySelector('#__fe_name');
  const ipIn       = editor.querySelector('#__fe_ip');
  const roleSwitch = editor.querySelector('#__fe_roleswitch');
  const roleLabel  = editor.querySelector('#__fe_rolelabel');
  const saveBtn    = editor.querySelector('#__fe_save');
  const cancelBtn  = editor.querySelector('#__fe_cancel');
  const closeBtn   = editor.querySelector('#__fe_close');

  if (nameIn) nameIn.focus();
  if (roleSwitch) roleSwitch.addEventListener('change', () => {
    if (roleLabel) roleLabel.textContent = roleSwitch.checked ? 'Master' : 'Worker';
  });

  const onKeyDown = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); saveBtn && saveBtn.click(); }
    else if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
  };
  const onPointerDownOutside = (ev) => { if (editor.contains(ev.target)) return; cleanup(); };

  function cleanup() {
    try {
      if (nameIn) nameIn.removeEventListener('keydown', onKeyDown);
      if (ipIn)   ipIn.removeEventListener('keydown',   onKeyDown);
      document.removeEventListener('pointerdown', onPointerDownOutside, true);
    } catch(e) {}
    if (!editor) return;
    editor.classList.remove('show');
    setTimeout(() => { if (editor.parentNode) editor.remove(); }, 220);
  }

  if (nameIn) nameIn.addEventListener('keydown', onKeyDown);
  if (ipIn)   ipIn.addEventListener('keydown',   onKeyDown);
  document.addEventListener('pointerdown', onPointerDownOutside, true);

  saveBtn.addEventListener('click', () => {
    const newName = nameIn.value.trim(); const newIP = ipIn.value.trim();
    const newRole = roleSwitch.checked ? 'master' : 'worker';
    if (!newName || !newIP) { showToast('Name and IP cannot be empty'); return; }
    const vm = vms.find(n => n.name === name);
    if (!vm) { cleanup(); return; }
    const oldRole = vm.role;
    if (primordialMaster === vm.name && newRole === 'worker') primordialMaster = null;
    vm.name = newName; vm.ip = newIP; vm.role = newRole;
    if (newRole === 'master' && oldRole === 'worker') {
      const existingMasters = vms.filter(v => v.role === 'master' && v.name !== newName).length;
      if (existingMasters === 0) primordialMaster = newName;
    }
    cleanup(); renderVMList(); showToast('Node updated');
  });
  cancelBtn.addEventListener('click', () => { cleanup(); });
  if (closeBtn) closeBtn.addEventListener('click', () => { cleanup(); });
}
