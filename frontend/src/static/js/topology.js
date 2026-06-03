// ── Topology diagram ──────────────────────────────────────────────────

// Returns SVG polygon points string for a pointy-top hexagon centered at (cx, cy) with radius r
function hexPts(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 90);
    pts.push(`${Math.round(cx + r * Math.cos(a))},${Math.round(cy + r * Math.sin(a))}`);
  }
  return pts.join(' ');
}

function renderTopology() {
  const container = document.getElementById('topology');
  if (!container) return;
  container.innerHTML = '';

  const baseWidth  = container.clientWidth || 800;
  const masters    = vms.filter(n => n.role === 'master');
  const workers    = vms.filter(n => n.role === 'worker');
  const mCount     = masters.length;
  const wCount     = workers.length;

  const COLS       = 3;            // max nodes per row
  const masterHexR = 58;
  const workerHexR = 50;
  const masterHexW = Math.ceil(masterHexR * Math.sqrt(3));  // ≈ 101
  const workerHexW = Math.ceil(workerHexR * Math.sqrt(3));  // ≈ 87
  const rowGap     = 28;           // gap between rows within a tier
  const tierGap    = 64;           // gap between master tier and worker tier
  const padTop     = 30;
  const padBot     = 30;

  const masterRows  = mCount > 0 ? Math.ceil(mCount / COLS) : 0;
  const workerRows  = wCount > 0 ? Math.ceil(wCount / COLS) : 0;
  const masterTierH = masterRows * (masterHexR * 2) + Math.max(0, masterRows - 1) * rowGap;
  const workerTierH = workerRows > 0
    ? workerRows * (workerHexR * 2) + Math.max(0, workerRows - 1) * rowGap : 0;

  const minWidthM = Math.min(Math.max(1, mCount), COLS) * (masterHexW + 60) + 60;
  const minWidthW = wCount > 0 ? Math.min(wCount, COLS) * (workerHexW + 50) + 50 : 0;
  const width  = Math.max(baseWidth, minWidthM, minWidthW);
  const height = Math.max(
    padTop + masterTierH + (workerRows > 0 ? tierGap + workerTierH : 0) + padBot,
    240
  );

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg   = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('xmlns', svgNS);

  // x-center of column j within a row of rowCount nodes
  function nodeX(j, rowCount) { return Math.round((j + 1) * (width / (rowCount + 1))); }

  // ── tier separator line ──────────────────────────────────────────────
  if (workerRows > 0) {
    const sepY = Math.round(padTop + masterTierH + tierGap / 2);
    const sep  = document.createElementNS(svgNS, 'line');
    sep.setAttribute('x1', 24); sep.setAttribute('y1', sepY);
    sep.setAttribute('x2', width - 24); sep.setAttribute('y2', sepY);
    sep.setAttribute('stroke', 'rgba(255,255,255,0.07)');
    sep.setAttribute('stroke-width', '1');
    sep.setAttribute('stroke-dasharray', '4 6');
    svg.appendChild(sep);
  }

  // ── tier labels ──────────────────────────────────────────────────────
  function makeTierLabel(text, y, color) {
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', 20); t.setAttribute('y', y);
    t.setAttribute('fill', color); t.setAttribute('font-size', '9');
    t.setAttribute('font-weight', '700'); t.setAttribute('letter-spacing', '1.8');
    t.setAttribute('dominant-baseline', 'middle'); t.setAttribute('opacity', '0.55');
    t.textContent = text;
    return t;
  }
  if (mCount > 0) {
    svg.appendChild(makeTierLabel('CONTROL PLANE', padTop + 8, '#9cff6e'));
  }
  if (workerRows > 0) {
    svg.appendChild(makeTierLabel('WORKER NODES', padTop + masterTierH + tierGap + 8, '#7dd3fc'));
  }

  // ── master nodes ─────────────────────────────────────────────────────
  masters.forEach((m, i) => {
    const row      = Math.floor(i / COLS);
    const col      = i % COLS;
    const rowCount = Math.min(COLS, mCount - row * COLS);
    const x        = nodeX(col, rowCount);
    const cy       = padTop + masterHexR + row * (masterHexR * 2 + rowGap);
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('data-name', m.name); g.setAttribute('data-ip', m.ip);
    g.setAttribute('data-role', 'master'); g.setAttribute('class', 'topo-node');
    const hex = document.createElementNS(svgNS, 'polygon');
    hex.setAttribute('points', hexPts(x, cy, masterHexR));
    hex.setAttribute('fill', 'rgba(156,255,110,0.08)');
    hex.setAttribute('stroke', '#9cff6e');
    hex.setAttribute('stroke-width', '2');
    g.appendChild(hex);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x); label.setAttribute('y', cy - 14);
    label.setAttribute('fill', '#ffffff'); label.setAttribute('font-size', '14');
    label.setAttribute('font-weight', '700'); label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle'); label.textContent = m.name;
    g.appendChild(label);
    const roleT = document.createElementNS(svgNS, 'text');
    roleT.setAttribute('x', x); roleT.setAttribute('y', cy + 1);
    roleT.setAttribute('fill', '#9cff6e'); roleT.setAttribute('font-size', '10');
    roleT.setAttribute('font-weight', '600'); roleT.setAttribute('text-anchor', 'middle');
    roleT.setAttribute('dominant-baseline', 'middle'); roleT.setAttribute('opacity', '0.9');
    roleT.textContent = 'MASTER';
    g.appendChild(roleT);
    const ipT = document.createElementNS(svgNS, 'text');
    ipT.setAttribute('x', x); ipT.setAttribute('y', cy + 16);
    ipT.setAttribute('fill', '#9cff6e'); ipT.setAttribute('font-size', '10');
    ipT.setAttribute('text-anchor', 'middle'); ipT.setAttribute('dominant-baseline', 'middle');
    ipT.setAttribute('opacity', '0.75');
    ipT.textContent = m.ip;
    g.appendChild(ipT);
    g.addEventListener('click',      () => showTopoInfo(m.name, m.ip, 'master', x, cy - masterHexR));
    g.addEventListener('dblclick',   () => openTopoEditor(m.name));
    g.addEventListener('mouseenter', () => g.classList.add('highlight'));
    g.addEventListener('mouseleave', () => g.classList.remove('highlight'));
    svg.appendChild(g);
  });

  // ── worker nodes ─────────────────────────────────────────────────────
  const workerTierTopY = padTop + masterTierH + tierGap;
  workers.forEach((w, i) => {
    const row      = Math.floor(i / COLS);
    const col      = i % COLS;
    const rowCount = Math.min(COLS, wCount - row * COLS);
    const x        = nodeX(col, rowCount);
    const cy       = workerTierTopY + workerHexR + row * (workerHexR * 2 + rowGap);
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', 'topo-node'); g.setAttribute('data-name', w.name);
    g.setAttribute('data-ip', w.ip); g.setAttribute('data-role', 'worker');
    const hex = document.createElementNS(svgNS, 'polygon');
    hex.setAttribute('points', hexPts(x, cy, workerHexR));
    hex.setAttribute('fill', 'rgba(125,211,252,0.07)');
    hex.setAttribute('stroke', '#7dd3fc');
    hex.setAttribute('stroke-width', '1.8');
    g.appendChild(hex);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x); label.setAttribute('y', cy - 12);
    label.setAttribute('fill', '#ffffff'); label.setAttribute('font-size', '13');
    label.setAttribute('font-weight', '600'); label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle'); label.textContent = w.name;
    g.appendChild(label);
    const roleT = document.createElementNS(svgNS, 'text');
    roleT.setAttribute('x', x); roleT.setAttribute('y', cy + 1);
    roleT.setAttribute('fill', '#7dd3fc'); roleT.setAttribute('font-size', '9');
    roleT.setAttribute('font-weight', '600'); roleT.setAttribute('text-anchor', 'middle');
    roleT.setAttribute('dominant-baseline', 'middle'); roleT.setAttribute('opacity', '0.9');
    roleT.textContent = 'WORKER';
    g.appendChild(roleT);
    const ipT = document.createElementNS(svgNS, 'text');
    ipT.setAttribute('x', x); ipT.setAttribute('y', cy + 14);
    ipT.setAttribute('fill', '#7dd3fc'); ipT.setAttribute('font-size', '9');
    ipT.setAttribute('text-anchor', 'middle'); ipT.setAttribute('dominant-baseline', 'middle');
    ipT.setAttribute('opacity', '0.75');
    ipT.textContent = w.ip;
    g.appendChild(ipT);
    g.addEventListener('click',      () => showTopoInfo(w.name, w.ip, 'worker', x, cy - workerHexR));
    g.addEventListener('dblclick',   () => openTopoEditor(w.name));
    g.addEventListener('mouseenter', () => g.classList.add('highlight'));
    g.addEventListener('mouseleave', () => g.classList.remove('highlight'));
    svg.appendChild(g);
  });

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

// ── Render read-only topology into any container ──────────────────────────
function renderTopologyTo(containerId, nodeList) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';

  const nodes   = nodeList || [];
  const masters = nodes.filter(n => n.role === 'master');
  const workers = nodes.filter(n => n.role === 'worker');
  const mCount  = masters.length;
  const wCount  = workers.length;
  if (mCount === 0 && wCount === 0) return;

  const baseWidth  = container.clientWidth || 800;
  const COLS       = 3;
  const masterHexR = 58;
  const workerHexR = 50;
  const masterHexW = Math.ceil(masterHexR * Math.sqrt(3));
  const workerHexW = Math.ceil(workerHexR * Math.sqrt(3));
  const rowGap     = 28;
  const tierGap    = 64;
  const padTop     = 30;
  const padBot     = 30;

  const masterRows  = mCount > 0 ? Math.ceil(mCount / COLS) : 0;
  const workerRows  = wCount > 0 ? Math.ceil(wCount / COLS) : 0;
  const masterTierH = masterRows * (masterHexR * 2) + Math.max(0, masterRows - 1) * rowGap;
  const workerTierH = workerRows > 0
    ? workerRows * (workerHexR * 2) + Math.max(0, workerRows - 1) * rowGap : 0;

  const minWidthM = Math.min(Math.max(1, mCount), COLS) * (masterHexW + 60) + 60;
  const minWidthW = wCount > 0 ? Math.min(wCount, COLS) * (workerHexW + 50) + 50 : 0;
  const width  = Math.max(baseWidth, minWidthM, minWidthW);
  const height = Math.max(
    padTop + masterTierH + (workerRows > 0 ? tierGap + workerTierH : 0) + padBot, 240
  );

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg   = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('xmlns', svgNS);

  function nodeX(j, rowCount) { return Math.round((j + 1) * (width / (rowCount + 1))); }

  if (workerRows > 0) {
    const sepY = Math.round(padTop + masterTierH + tierGap / 2);
    const sep  = document.createElementNS(svgNS, 'line');
    sep.setAttribute('x1', 24); sep.setAttribute('y1', sepY);
    sep.setAttribute('x2', width - 24); sep.setAttribute('y2', sepY);
    sep.setAttribute('stroke', 'rgba(255,255,255,0.07)');
    sep.setAttribute('stroke-width', '1');
    sep.setAttribute('stroke-dasharray', '4 6');
    svg.appendChild(sep);
  }

  function makeTierLabel(text, y, color) {
    const t = document.createElementNS(svgNS, 'text');
    t.setAttribute('x', 20); t.setAttribute('y', y);
    t.setAttribute('fill', color); t.setAttribute('font-size', '9');
    t.setAttribute('font-weight', '700'); t.setAttribute('letter-spacing', '1.8');
    t.setAttribute('dominant-baseline', 'middle'); t.setAttribute('opacity', '0.55');
    t.textContent = text;
    return t;
  }
  if (mCount > 0) svg.appendChild(makeTierLabel('CONTROL PLANE', padTop + 8, '#9cff6e'));
  if (workerRows > 0) svg.appendChild(makeTierLabel('WORKER NODES', padTop + masterTierH + tierGap + 8, '#7dd3fc'));

  masters.forEach((m, i) => {
    const row      = Math.floor(i / COLS);
    const col      = i % COLS;
    const rowCount = Math.min(COLS, mCount - row * COLS);
    const x        = nodeX(col, rowCount);
    const cy       = padTop + masterHexR + row * (masterHexR * 2 + rowGap);
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('data-name', m.name); g.setAttribute('data-ip', m.ip);
    g.setAttribute('data-role', 'master'); g.setAttribute('class', 'topo-node');
    const hex = document.createElementNS(svgNS, 'polygon');
    hex.setAttribute('points', hexPts(x, cy, masterHexR));
    hex.setAttribute('fill', 'rgba(156,255,110,0.08)');
    hex.setAttribute('stroke', '#9cff6e');
    hex.setAttribute('stroke-width', '2');
    g.appendChild(hex);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x); label.setAttribute('y', cy - 14);
    label.setAttribute('fill', '#ffffff'); label.setAttribute('font-size', '14');
    label.setAttribute('font-weight', '700'); label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle'); label.textContent = m.name;
    g.appendChild(label);
    const roleT = document.createElementNS(svgNS, 'text');
    roleT.setAttribute('x', x); roleT.setAttribute('y', cy + 1);
    roleT.setAttribute('fill', '#9cff6e'); roleT.setAttribute('font-size', '10');
    roleT.setAttribute('font-weight', '600'); roleT.setAttribute('text-anchor', 'middle');
    roleT.setAttribute('dominant-baseline', 'middle'); roleT.setAttribute('opacity', '0.9');
    roleT.textContent = 'MASTER';
    g.appendChild(roleT);
    const ipT = document.createElementNS(svgNS, 'text');
    ipT.setAttribute('x', x); ipT.setAttribute('y', cy + 16);
    ipT.setAttribute('fill', '#9cff6e'); ipT.setAttribute('font-size', '10');
    ipT.setAttribute('text-anchor', 'middle'); ipT.setAttribute('dominant-baseline', 'middle');
    ipT.setAttribute('opacity', '0.75');
    ipT.textContent = m.ip;
    g.appendChild(ipT);
    g.addEventListener('mouseenter', () => g.classList.add('highlight'));
    g.addEventListener('mouseleave', () => g.classList.remove('highlight'));
    svg.appendChild(g);
  });

  const workerTierTopY = padTop + masterTierH + tierGap;
  workers.forEach((w, i) => {
    const row      = Math.floor(i / COLS);
    const col      = i % COLS;
    const rowCount = Math.min(COLS, wCount - row * COLS);
    const x        = nodeX(col, rowCount);
    const cy       = workerTierTopY + workerHexR + row * (workerHexR * 2 + rowGap);
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('class', 'topo-node'); g.setAttribute('data-name', w.name);
    g.setAttribute('data-ip', w.ip); g.setAttribute('data-role', 'worker');
    const hex = document.createElementNS(svgNS, 'polygon');
    hex.setAttribute('points', hexPts(x, cy, workerHexR));
    hex.setAttribute('fill', 'rgba(125,211,252,0.07)');
    hex.setAttribute('stroke', '#7dd3fc');
    hex.setAttribute('stroke-width', '1.8');
    g.appendChild(hex);
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x); label.setAttribute('y', cy - 12);
    label.setAttribute('fill', '#ffffff'); label.setAttribute('font-size', '13');
    label.setAttribute('font-weight', '600'); label.setAttribute('text-anchor', 'middle');
    label.setAttribute('dominant-baseline', 'middle'); label.textContent = w.name;
    g.appendChild(label);
    const roleT = document.createElementNS(svgNS, 'text');
    roleT.setAttribute('x', x); roleT.setAttribute('y', cy + 1);
    roleT.setAttribute('fill', '#7dd3fc'); roleT.setAttribute('font-size', '9');
    roleT.setAttribute('font-weight', '600'); roleT.setAttribute('text-anchor', 'middle');
    roleT.setAttribute('dominant-baseline', 'middle'); roleT.setAttribute('opacity', '0.9');
    roleT.textContent = 'WORKER';
    g.appendChild(roleT);
    const ipT = document.createElementNS(svgNS, 'text');
    ipT.setAttribute('x', x); ipT.setAttribute('y', cy + 14);
    ipT.setAttribute('fill', '#7dd3fc'); ipT.setAttribute('font-size', '9');
    ipT.setAttribute('text-anchor', 'middle'); ipT.setAttribute('dominant-baseline', 'middle');
    ipT.setAttribute('opacity', '0.75');
    ipT.textContent = w.ip;
    g.appendChild(ipT);
    g.addEventListener('mouseenter', () => g.classList.add('highlight'));
    g.addEventListener('mouseleave', () => g.classList.remove('highlight'));
    svg.appendChild(g);
  });

  container.appendChild(svg);
}

// ── Fade a node out of a topology container (called when uninstalled) ─────
function fadeOutTopoNode(containerId, nodeName) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const svg = container.querySelector('svg');
  if (!svg) return;
  const g = Array.from(svg.querySelectorAll('g'))
    .find(el => el.getAttribute('data-name') === nodeName);
  if (!g) return;
  g.style.transformBox    = 'fill-box';
  g.style.transformOrigin = 'center';
  g.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
  requestAnimationFrame(() => {
    g.style.opacity   = '0';
    g.style.transform = 'scale(0.5)';
  });
  setTimeout(() => { if (g.parentNode) g.parentNode.removeChild(g); }, 750);
}

// ── Mark a node as failed in a topology container (turns it red) ──────────
function markTopoNodeFailed(containerId, nodeName) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const svg = container.querySelector('svg');
  if (!svg) return;
  const g = Array.from(svg.querySelectorAll('g'))
    .find(el => el.getAttribute('data-name') === nodeName);
  if (!g) return;
  const hex = g.querySelector('polygon');
  if (hex) {
    hex.setAttribute('fill', 'rgba(239,68,68,0.15)');
    hex.setAttribute('stroke', '#ef4444');
    hex.setAttribute('stroke-width', '2.5');
  }
  g.querySelectorAll('text').forEach(t => t.setAttribute('fill', '#fca5a5'));
}
