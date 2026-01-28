// Client-side state
let vms = [];
let primordialMaster = null;
let inventoryExists = false;
let deletedVMs = []; // Track VMs to delete on next generate
let allConnectionsPass = false; // Track if all connection tests passed

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&"'<>]/g, function (s) {
    return ({'&':'&amp;','"':'&quot;',"'":"&#39;","<":"&lt;",">":"&gt;"})[s];
  });
}

function showToast(message, timeout = 3000) {
  const t = document.getElementById('toast');
  if (!t) return console.warn('toast element missing');
  t.textContent = message;
  t.classList.add('show');
  t.setAttribute('aria-hidden','false');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>{ t.classList.remove('show'); t.setAttribute('aria-hidden','true'); }, timeout);
}

function showConfirmToast(message, onConfirm, onCancel) {
  const t = document.getElementById('toast');
  if (!t) return console.warn('toast element missing');
  t.innerHTML = `${escapeHtml(message)}<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;"><button id="toast-confirm" style="padding:6px 12px;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer;">Proceed</button><button id="toast-cancel" style="padding:6px 12px;background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:6px;cursor:pointer;">Cancel</button></div>`;
  t.classList.add('show');
  t.setAttribute('aria-hidden','false');
  
  const confirmBtn = document.getElementById('toast-confirm');
  const cancelBtn = document.getElementById('toast-cancel');
  
  const cleanup = () => {
    t.classList.remove('show');
    t.setAttribute('aria-hidden','true');
    setTimeout(() => { t.innerHTML = ''; }, 300);
  };
  
  if (confirmBtn) confirmBtn.addEventListener('click', () => { cleanup(); if(onConfirm) onConfirm(); });
  if (cancelBtn) cancelBtn.addEventListener('click', () => { cleanup(); if(onCancel) onCancel(); });
}

function updateProceedButton() {
  const proceedBtn = document.getElementById('proceedToTest');
  if (!proceedBtn) return;
  if (inventoryExists) {
    proceedBtn.disabled = false;
  } else {
    proceedBtn.disabled = true;
  }
  updateTabStates();
}

// Sliding Bubble Navigation
let activeTabIndex = 0;

const updateBubblePosition = (element) => {
  const bubble = document.getElementById('bubbleIndicator');
  const nav = document.getElementById('tabNavigation');
  
  if (!bubble || !nav || !element) return;
  
  const navRect = nav.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  
  const padding = 4; // Extra padding to make bubble slightly bigger than text
  
  bubble.style.left = `${elementRect.left - navRect.left - padding}px`;
  bubble.style.top = `${elementRect.top - navRect.top - padding}px`;
  bubble.style.width = `${elementRect.width + padding * 2}px`;
  bubble.style.height = `${elementRect.height + padding * 2}px`;
};

const updateTabStates = () => {
  const navList = document.getElementById('navList');
  if (!navList) return;
  
  const tabItems = navList.querySelectorAll('li');
  
  // Update Test Connections tab (index 1)
  const connectionsTab = tabItems[1];
  if (connectionsTab) {
    if (inventoryExists) {
      connectionsTab.classList.remove('disabled');
      connectionsTab.style.pointerEvents = 'auto';
      connectionsTab.style.opacity = '1';
    } else {
      connectionsTab.classList.add('disabled');
      connectionsTab.style.pointerEvents = 'none';
      connectionsTab.style.opacity = '0.4';
    }
  }
  
  // Update Deploy tab (index 2)
  const deployTab = tabItems[2];
  if (deployTab) {
    if (allConnectionsPass) {
      deployTab.classList.remove('disabled');
      deployTab.style.pointerEvents = 'auto';
      deployTab.style.opacity = '1';
    } else {
      deployTab.classList.add('disabled');
      deployTab.style.pointerEvents = 'none';
      deployTab.style.opacity = '0.4';
    }
  }
};

function setupHandlers(){
  console.log('setupHandlers running');
  
  // Tab navigation with sliding bubble
  const navList = document.getElementById('navList');
  if (navList) {
    const tabItems = navList.querySelectorAll('li');
    
    tabItems.forEach((item, index) => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Check if tab is disabled
        if (item.classList.contains('disabled')) {
          if (index === 1) {
            showToast('⚠️ Please generate or detect an inventory first before testing connections.', 3500);
          } else if (index === 2) {
            showToast('⚠️ Please complete connection tests successfully before accessing deployment.', 3500);
          }
          return;
        }
        
        const tabName = item.getAttribute('data-tab');
        activeTabIndex = index;
        
        // Update active state
        tabItems.forEach(li => li.classList.remove('active'));
        item.classList.add('active');
        
        // Switch tab content
        switchTab(tabName);
        
        // Update bubble position
        updateBubblePosition(item);
      });
    });
    
    // Initialize bubble position on load
    const activeLi = tabItems[activeTabIndex];
    if (activeLi) {
      // Small delay to ensure layout is ready
      setTimeout(() => updateBubblePosition(activeLi), 50);
    }
    
    // Initialize tab states
    updateTabStates();
    
    // Handle window resize
    window.addEventListener('resize', () => {
      const currentActiveLi = navList.querySelectorAll('li')[activeTabIndex];
      if (currentActiveLi) {
        updateBubblePosition(currentActiveLi);
      }
    });
  }
  
  const roleSwitch = document.getElementById('roleSwitch');
  if (roleSwitch) roleSwitch.addEventListener('change', function(){ const lbl = document.getElementById('roleLabel'); if (lbl) lbl.textContent = this.checked ? 'Master' : 'Worker'; });

  const addBtn = document.getElementById('addVM');
  if (addBtn){
    addBtn.addEventListener('click', ()=>{
      console.log('Add VM clicked');
      const nameEl = document.getElementById('vmName');
      const ipEl = document.getElementById('vmIP');
      if (!nameEl || !ipEl) { console.warn('inputs missing'); return; }
      const name = nameEl.value.trim();
      const ip = ipEl.value.trim();
      const role = (document.getElementById('roleSwitch')?.checked) ? 'master' : 'worker';
      if (!name || !ip) { showToast('Please fill out both VM name and IP.'); return; }
      const existingMasters = vms.filter(x=>x.role==='master').length;
      vms.push({name, ip, role});
      if (role==='master' && existingMasters===0) primordialMaster = name;
      nameEl.value=''; ipEl.value=''; nameEl.focus();
      renderVMList(); showToast(`${name} added`);
    });
  }

  const gen = document.getElementById('generate');
  if (gen) gen.addEventListener('click', async ()=>{
    const masters = vms.filter(x=>x.role==='master');
    if (masters.length===0) { showToast('Add at least one master before generating.'); return; }
    try {
      // Delete files for removed VMs
      for (const vmName of deletedVMs) {
        await deleteHostFile(vmName);
      }
      deletedVMs = [];
      
      const res = await fetch('/generate', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({vms, primordialMaster}) });
      let json = null; try{ json = await res.json(); }catch(e){}
      if (!res.ok) { showToast((json&&json.message)?json.message:'Generation failed'); return; }
      inventoryExists = true;
      allConnectionsPass = false; // Reset connection test status when new inventory is generated
      updateProceedButton();
      showToast('Inventory files generated!');
      // Switch to connection check view
      setTimeout(()=>{ switchToConnectionView(); }, 800);
    } catch(e){ showToast('Network error.'); }
  });

  const proceedBtn = document.getElementById('proceedToTest');
  if (proceedBtn) proceedBtn.addEventListener('click', ()=>{ 
    if (!inventoryExists) {
      showToast('⚠️ Please generate or detect an inventory first before testing connections.', 3500);
      return;
    }
    switchToConnectionView(); 
  });

  const detectBtn = document.getElementById('detectInventory');
  if (detectBtn) detectBtn.addEventListener('click', async ()=>{ await detectInventory(); });

  const clearBtn = document.getElementById('clearInventory');
  if (clearBtn) clearBtn.addEventListener('click', ()=>{ clearInventory(); });

  const backBtn = document.getElementById('backToInventory');
  if (backBtn) backBtn.addEventListener('click', ()=>{ switchToInventoryView(); });

  const testBtn = document.getElementById('testConnections');
  if (testBtn) testBtn.addEventListener('click', ()=>{ testConnections(); });

  const dl = document.getElementById('downloadTopo');
  if (dl) dl.addEventListener('click', ()=>{
    const container = document.getElementById('topology'); if (!container) { showToast('Nothing to download'); return; }
    const svg = container.querySelector('svg'); if (!svg) { showToast('Nothing to download'); return; }
    const clone = svg.cloneNode(true);
    // Calculate actual width needed for all masters and workers
    const masters = vms.filter(n=>n.role==='master');
    const workers = vms.filter(n=>n.role==='worker');
    const masterRectW = 220; const minMasterSpacing = 50;
    const minWidthForMasters = masters.length * (masterRectW + minMasterSpacing) + minMasterSpacing;
    const workerRectW = 200; const minWorkerSpacing = 50;
    const minWidthForWorkers = workers.length > 0 ? workers.length * (workerRectW + minWorkerSpacing) + minWorkerSpacing : 0;
    const w = Math.max(container.clientWidth || 900, minWidthForMasters, minWidthForWorkers);
    const h = Math.max(240, Math.floor((vms.length+1)*40));
    clone.setAttribute('width', w); clone.setAttribute('height', h); clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const s = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([s], {type:'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const img = new Image(); img.onload = ()=>{ const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h; const ctx=canvas.getContext('2d'); ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h); ctx.drawImage(img,0,0); URL.revokeObjectURL(url); const png=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=png; a.download='k3s-topology.png'; document.body.appendChild(a); a.click(); a.remove(); };
    img.onerror = ()=>{ showToast('Failed to render image'); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function deleteVM(index){ if (index<0||index>=vms.length) return; const vmName = vms[index].name; if (primordialMaster===vmName) primordialMaster=null; deletedVMs.push(vmName); vms.splice(index,1); renderVMList(); showToast('Entry removed'); }

async function deleteHostFile(name) {
  try {
    await fetch('/delete-host', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name}) });
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
    const res = await fetch('/detect-inventory');
    const json = await res.json();
    
    if (!res.ok) {
      showToast(json.message || 'No inventory found');
      return;
    }
    
    vms = json.vms || [];
    primordialMaster = json.primordial_master || null;
    deletedVMs = []; // Clear deletion tracking when loading fresh inventory
    inventoryExists = true;
    allConnectionsPass = false; // Reset connection test status when loading inventory
    updateProceedButton();
    renderVMList();
    showToast(`Loaded ${vms.length} VM(s) from inventory`);
  } catch(e) {
    showToast('Failed to detect inventory');
    console.error('Detect error:', e);
  }
}

function clearInventory() {
  if (vms.length === 0) {
    showToast('No entries to clear');
    return;
  }
  
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

function setPrimordialMaster(name){ primordialMaster=name; renderVMList(); showToast(`${name} set as primordial master`); }

function updateGenerateState(){ const btn=document.getElementById('generate'); if(!btn) return; const masters=vms.filter(x=>x.role==='master'); if(masters.length===0){ btn.setAttribute('aria-disabled','true'); btn.classList.add('disabled'); } else { btn.setAttribute('aria-disabled','false'); btn.classList.remove('disabled'); } updateProceedButton(); }

function renderVMList(){ const container=document.getElementById('vmList'); if(!container) return; container.innerHTML=''; const masters=vms.filter(vm=>vm.role==='master'); const multipleMasters=masters.length>1; vms.forEach((vm,index)=>{ const div=document.createElement('div'); div.className=`vm-entry ${vm.role}`; const left=document.createElement('div'); const title=document.createElement('span'); title.innerHTML=`<strong>${escapeHtml(vm.name)}</strong> (${escapeHtml(vm.ip)}) — <em>${vm.role.toUpperCase()}</em>`; left.appendChild(title); if(vm.role==='master'){ const label=document.createElement('label'); label.className='primordial-selector'; if(multipleMasters){ const radioWrapper = document.createElement('span'); radioWrapper.className='custom-radio'; const radio = document.createElement('input'); radio.type='radio'; radio.name='primordialMaster'; radio.checked = primordialMaster===vm.name; radio.addEventListener('click', ()=>setPrimordialMaster(vm.name)); const checkmark = document.createElement('span'); checkmark.className='radio-checkmark'; radioWrapper.appendChild(radio); radioWrapper.appendChild(checkmark); label.appendChild(radioWrapper); const labelText = document.createElement('span'); labelText.textContent='Primordial Master'; labelText.className='primordial-label'; label.appendChild(labelText); } else { const badge=document.createElement('span'); badge.textContent='Primordial Master'; badge.className='primordial-badge-auto'; label.appendChild(badge); } left.appendChild(label);} const rightBtn=document.createElement('button'); rightBtn.textContent='Delete'; rightBtn.addEventListener('click', ()=>deleteVM(index)); div.appendChild(left); div.appendChild(rightBtn); container.appendChild(div); }); updateGenerateState(); renderTopology(); }

function renderTopology(){ const container=document.getElementById('topology'); if(!container) return; container.innerHTML=''; const baseWidth = container.clientWidth || 800; const masters = vms.filter(n=>n.role==='master'); const workers = vms.filter(n=>n.role==='worker'); const mCount=Math.max(1,masters.length); const wCount=Math.max(0,workers.length);
  // Calculate required width to prevent master node overlap
  const masterRectW = 220; const minMasterSpacing = 50;
  const minWidthForMasters = mCount * (masterRectW + minMasterSpacing) + minMasterSpacing;
  // Calculate required width to prevent worker node overlap
  const workerRectW = 200; const minWorkerSpacing = 50;
  const minWidthForWorkers = wCount > 0 ? wCount * (workerRectW + minWorkerSpacing) + minWorkerSpacing : 0;
  // Use the maximum of base width, masters width, and workers width
  const width = Math.max(baseWidth, minWidthForMasters, minWidthForWorkers);
  const height = Math.max(240, Math.floor((vms.length+1)*40)); const svgNS='http://www.w3.org/2000/svg'; const svg=document.createElementNS(svgNS,'svg'); svg.setAttribute('viewBox',`0 0 ${width} ${height}`); svg.setAttribute('preserveAspectRatio','xMidYMid meet'); svg.setAttribute('xmlns',svgNS);
  const topY=60; const botY=height-60;
  function nodeX(i,count){ return Math.round((i+1)*(width/(count+1))); }
  const defs=document.createElementNS(svgNS,'defs'); const marker=document.createElementNS(svgNS,'marker'); marker.setAttribute('id','arrow'); marker.setAttribute('markerUnits','strokeWidth'); marker.setAttribute('markerWidth','10'); marker.setAttribute('markerHeight','10'); marker.setAttribute('refX','8'); marker.setAttribute('refY','4'); marker.setAttribute('orient','auto'); const mpath=document.createElementNS(svgNS,'path'); mpath.setAttribute('d','M0,0 L0,8 L10,4 z'); mpath.setAttribute('fill','#ffffff'); marker.appendChild(mpath); defs.appendChild(marker); svg.appendChild(defs);
  masters.forEach((m,i)=>{ const x=nodeX(i,mCount); const g=document.createElementNS(svgNS,'g'); g.setAttribute('data-name',m.name); g.setAttribute('data-ip',m.ip); g.setAttribute('data-role','master'); g.setAttribute('class','topo-node'); const rectW=masterRectW; const rectH=58; const rxX=x-rectW/2; const rect=document.createElementNS(svgNS,'rect'); rect.setAttribute('x',rxX); rect.setAttribute('y',topY-rectH/2); rect.setAttribute('width',rectW); rect.setAttribute('height',rectH); rect.setAttribute('fill','rgba(255,255,255,0.08)'); rect.setAttribute('stroke','#6366f1'); rect.setAttribute('stroke-width','2'); rect.setAttribute('rx',8); rect.setAttribute('ry',8); g.appendChild(rect); const label=document.createElementNS(svgNS,'text'); label.setAttribute('x',x); label.setAttribute('y',topY-6); label.setAttribute('fill','#ffffff'); label.setAttribute('font-size','16'); label.setAttribute('font-weight','700'); label.setAttribute('text-anchor','middle'); label.setAttribute('dominant-baseline','middle'); label.textContent = m.name; g.appendChild(label); const sub=document.createElementNS(svgNS,'text'); sub.setAttribute('x',x); sub.setAttribute('y',topY+12); sub.setAttribute('fill','#ddd'); sub.setAttribute('font-size','13'); sub.setAttribute('text-anchor','middle'); sub.setAttribute('dominant-baseline','middle'); sub.textContent = `${m.ip} • MASTER`; g.appendChild(sub); g.addEventListener('click', ()=>showTopoInfo(m.name,m.ip,'master',x,topY-rectH/2)); g.addEventListener('dblclick', ()=>openTopoEditor(m.name)); g.addEventListener('mouseenter', ()=>g.classList.add('highlight')); g.addEventListener('mouseleave', ()=>g.classList.remove('highlight')); svg.appendChild(g); });
  workers.forEach((w,i)=>{ const x=nodeX(i,Math.max(1,wCount)); const g=document.createElementNS(svgNS,'g'); g.setAttribute('class','topo-node'); g.setAttribute('data-name',w.name); g.setAttribute('data-ip',w.ip); g.setAttribute('data-role','worker'); const rectW=200; const rectH=46; const rxX=x-rectW/2; const rect=document.createElementNS(svgNS,'rect'); rect.setAttribute('x',rxX); rect.setAttribute('y',botY-rectH/2); rect.setAttribute('width',rectW); rect.setAttribute('height',rectH); rect.setAttribute('fill','rgba(255,255,255,0.08)'); rect.setAttribute('stroke','#ffffff'); rect.setAttribute('stroke-width','1.6'); rect.setAttribute('rx',6); rect.setAttribute('ry',6); g.appendChild(rect); const label=document.createElementNS(svgNS,'text'); label.setAttribute('x',x); label.setAttribute('y',botY-4); label.setAttribute('fill','#ffffff'); label.setAttribute('font-size','14'); label.setAttribute('text-anchor','middle'); label.setAttribute('dominant-baseline','middle'); label.textContent = w.name; g.appendChild(label); const sub=document.createElementNS(svgNS,'text'); sub.setAttribute('x',x); sub.setAttribute('y',botY+12); sub.setAttribute('fill','#ddd'); sub.setAttribute('font-size','12'); sub.setAttribute('text-anchor','middle'); sub.setAttribute('dominant-baseline','middle'); sub.textContent = `${w.ip} • WORKER`; g.appendChild(sub); g.addEventListener('click', ()=>showTopoInfo(w.name,w.ip,'worker',x,botY-rectH/2)); g.addEventListener('dblclick', ()=>openTopoEditor(w.name)); g.addEventListener('mouseenter', ()=>g.classList.add('highlight')); g.addEventListener('mouseleave', ()=>g.classList.remove('highlight')); svg.appendChild(g); const primName=primordialMaster; const primIndex=masters.findIndex(mm=>mm.name===primName); const primX = primIndex>=0 ? nodeX(primIndex,mCount) : nodeX(0,mCount); const startX=x; const startY=botY-rectH/2; const endX=primX; const endY=topY+20; const midY=(startY+endY)/2; const line=document.createElementNS(svgNS,'path'); const d=`M ${startX} ${startY} C ${startX} ${midY} ${endX} ${midY} ${endX} ${endY}`; line.setAttribute('d',d); line.setAttribute('fill','none'); line.setAttribute('stroke','#ffffff'); line.setAttribute('stroke-width','1.8'); line.setAttribute('stroke-linecap','round'); line.setAttribute('marker-end','url(#arrow)'); svg.appendChild(line); });
  if (masters.length>1){ for(let i=0;i<masters.length-1;i++){ const x1=nodeX(i,mCount); const x2=nodeX(i+1,mCount); const y=topY+30; const link=document.createElementNS(svgNS,'path'); const d=`M ${x1} ${y} C ${x1} ${y+36} ${x2} ${y+36} ${x2} ${y}`; link.setAttribute('d',d); link.setAttribute('stroke','#6366f1'); link.setAttribute('stroke-width','2'); link.setAttribute('fill','none'); link.setAttribute('class','topo-link master-link'); svg.appendChild(link); } }
  container.appendChild(svg);
}

function switchTab(tabName) {
  // Update tab buttons
  const tabButtons = document.querySelectorAll('.tab-button');
  tabButtons.forEach(button => {
    if (button.getAttribute('data-tab') === tabName) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });
  
  // Update tab content
  const allContent = document.querySelectorAll('[data-tab-content]');
  allContent.forEach(content => {
    if (content.getAttribute('data-tab-content') === tabName) {
      content.style.display = 'block';
    } else {
      content.style.display = 'none';
    }
  });
  
  // Update navbar active state and bubble
  const navList = document.getElementById('navList');
  if (navList) {
    const tabItems = navList.querySelectorAll('li');
    const tabNames = ['inventory', 'connections', 'deploy'];
    const targetIndex = tabNames.indexOf(tabName);
    
    if (targetIndex !== -1) {
      tabItems.forEach((item, index) => {
        if (index === targetIndex) {
          item.classList.add('active');
          updateBubblePosition(item);
        } else {
          item.classList.remove('active');
        }
      });
      activeTabIndex = targetIndex;
    }
  }
}

function switchToConnectionView(){ 
  switchTab('connections'); 
}

function switchToInventoryView(){ switchTab('inventory'); const results=document.getElementById('connectionResults'); if(results) results.style.display='none'; }

async function testConnections(){ const username=document.getElementById('sshUsername')?.value.trim(); const sshKey=document.getElementById('sshKey')?.value.trim(); if(!username||!sshKey){ showToast('Please provide SSH username and private key'); return; } const resultsSection=document.getElementById('connectionResults'); const connectionList=document.getElementById('connectionList'); if(!resultsSection||!connectionList) return; resultsSection.style.display='block'; connectionList.innerHTML=''; allConnectionsPass = false; updateTabStates(); vms.forEach(vm=>{ const item=document.createElement('div'); item.className='connection-item'; item.id=`conn-${vm.name}`; item.innerHTML=`<div class="connection-info"><div class="connection-status loading"></div><div class="connection-details"><div class="connection-name">${escapeHtml(vm.name)}</div><div class="connection-ip">${escapeHtml(vm.ip)}</div><div class="connection-message">Testing connection...</div></div></div>`; connectionList.appendChild(item); }); let allPassed = true; for(const vm of vms){ const passed = await testSingleConnection(vm.name, vm.ip, username, sshKey); if (!passed) allPassed = false; } if (allPassed && vms.length > 0) { allConnectionsPass = true; updateTabStates(); showToast('All connections passed! Deploy tab is now available.', 4000); } }

async function testSingleConnection(name, ip, username, sshKey, isRetry=false){ const item=document.getElementById(`conn-${name}`); if(!item) return false; const statusEl=item.querySelector('.connection-status'); const messageEl=item.querySelector('.connection-message'); const actionsEl=item.querySelector('.connection-actions'); if(actionsEl) actionsEl.remove(); if(statusEl){ statusEl.className='connection-status loading'; statusEl.textContent=''; } if(messageEl) messageEl.textContent='Testing connection...'; try{ const res=await fetch('/test-ssh', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name, ip, username, ssh_key: sshKey}) }); const json=await res.json(); if(res.ok && json.status==='success'){ if(statusEl){ statusEl.className='connection-status success'; statusEl.textContent='✓'; } if(messageEl) messageEl.textContent=json.message || 'Connection successful'; return true; }else{ if(statusEl){ statusEl.className='connection-status failure'; statusEl.textContent='✕'; } if(messageEl) messageEl.textContent=json.message || 'Connection failed'; const actions=document.createElement('div'); actions.className='connection-actions'; const retryBtn=document.createElement('button'); retryBtn.className='retry-btn'; retryBtn.textContent='🔄 Retry'; retryBtn.addEventListener('click', async ()=>{ retryBtn.disabled=true; await testSingleConnection(name, ip, username, sshKey, true); retryBtn.disabled=false; }); actions.appendChild(retryBtn); item.appendChild(actions); return false; } }catch(e){ if(statusEl){ statusEl.className='connection-status failure'; statusEl.textContent='✕'; } if(messageEl) messageEl.textContent='Network error during test'; const actions=document.createElement('div'); actions.className='connection-actions'; const retryBtn=document.createElement('button'); retryBtn.className='retry-btn'; retryBtn.textContent='🔄 Retry'; retryBtn.addEventListener('click', async ()=>{ retryBtn.disabled=true; await testSingleConnection(name, ip, username, sshKey, true); retryBtn.disabled=false; }); actions.appendChild(retryBtn); item.appendChild(actions); return false; } }

function showTopoInfo(name, ip, role, x, y){ const info=document.getElementById('topoInfo'); if(!info) return; info.innerHTML=`<strong>${escapeHtml(name)}</strong><div class="topo-sub">${escapeHtml(ip)} • ${escapeHtml(role.toUpperCase())}</div>`; info.style.left='auto'; info.style.right='18px'; info.style.top=`${Math.max(12,y)}px`; info.classList.add('show'); info.setAttribute('aria-hidden','false'); clearTimeout(info._hide); info._hide=setTimeout(()=>{ info.classList.remove('show'); info.setAttribute('aria-hidden','true'); },4500); }

function openTopoEditor(name){ const node=vms.find(n=>n.name===name); if(!node) return; const container=document.getElementById('topology'); if(!container) return; const svg=container.querySelector('svg'); if(!svg) return; const existing=document.querySelector('.floating-editor'); if(existing) existing.remove(); const bboxNode = Array.from(svg.querySelectorAll('g')).find(g=>g.getAttribute('data-name')===name); if(!bboxNode) return; const bbox=bboxNode.getBBox(); const svgRect=svg.getBoundingClientRect(); const viewBox=svg.getAttribute('viewBox')?.split(' ').map(Number) || [0,0,svgRect.width,svgRect.height]; const vbW=viewBox[2]||svgRect.width; const vbH=viewBox[3]||svgRect.height; const scaleX=svgRect.width/vbW; const scaleY=svgRect.height/vbH; const clientX=Math.round(svgRect.left + bbox.x*scaleX + window.scrollX); const clientY=Math.round(svgRect.top + bbox.y*scaleY + window.scrollY); const clientW=Math.round(bbox.width*scaleX); const clientH=Math.round(bbox.height*scaleY); const editor=document.createElement('div'); editor.className='floating-editor inline-editor-fo'; editor.style.position='absolute'; editor.style.zIndex=99999; editor.style.pointerEvents='auto'; const effectiveWidth=Math.min(320, Math.max(280, Math.round(Math.min(window.innerWidth-48, svgRect.width*0.5)))); const effectiveHeight=Math.max(180, Math.round(Math.min(300, svgRect.height*0.5))); const viewportWidth = window.innerWidth + window.scrollX; const viewportHeight = window.innerHeight + window.scrollY; let px = clientX + clientW + 12; let py = clientY; if(px + effectiveWidth > viewportWidth - 12){ const leftX=clientX - effectiveWidth - 12; if(leftX>=window.scrollX + 12) px = leftX; else { px = Math.round(clientX + clientW/2 - effectiveWidth/2); if(px<window.scrollX + 12) px=window.scrollX + 12; if(px+effectiveWidth>viewportWidth-12) px=viewportWidth-effectiveWidth-12; py = clientY + clientH + 12; } } const currentViewportBottom = window.scrollY + window.innerHeight; if(py + effectiveHeight > currentViewportBottom - 12){ py = Math.max(window.scrollY + 12, py - effectiveHeight - clientH - 24); if(py < window.scrollY + 12) py = window.scrollY + 12; } editor.style.left = px + 'px'; editor.style.top = py + 'px'; editor.style.width = effectiveWidth + 'px'; editor.style.minHeight = effectiveHeight + 'px'; editor.innerHTML = `<div style="position:relative; background:#0b0b0b; padding:10px 12px 12px 12px; padding-top:34px; border-radius:8px; border:1px solid #6366f1; box-shadow:0 14px 40px rgba(0,0,0,0.6);"> <button id="__fe_close" aria-label="Close" style="position:absolute; right:8px; top:8px; background:transparent; border:none; color:#fff; font-size:20px; opacity:0.9; cursor:pointer; padding:2px 6px;">×</button> <div style="margin-bottom:8px;"><input id="__fe_name" class="svg-fo-input" placeholder="Name" value="${escapeHtml(node.name)}"></div> <div style="margin-bottom:8px;"><input id="__fe_ip" class="svg-fo-input" placeholder="IP" value="${escapeHtml(node.ip)}"></div> <div style="margin-bottom:12px; display:flex; align-items:center; gap:10px; color:#fff;"><label class="switch"><input type="checkbox" id="__fe_roleswitch" ${node.role==='master'?'checked':''}><span class="slider"></span></label><span id="__fe_rolelabel">${node.role==='master'?'Master':'Worker'}</span></div> <div class="svg-fo-actions"><button id="__fe_save" class="primary" style="padding:6px 12px;">Save</button> <button id="__fe_cancel" style="padding:6px 10px; background:transparent; border:1px solid rgba(255,255,255,0.06); color:#fff; border-radius:6px;">Cancel</button></div> </div>`; document.body.appendChild(editor); requestAnimationFrame(()=>editor.classList.add('show')); const nameIn = editor.querySelector('#__fe_name'); const ipIn = editor.querySelector('#__fe_ip'); const roleSwitch = editor.querySelector('#__fe_roleswitch'); const roleLabel = editor.querySelector('#__fe_rolelabel'); const saveBtn = editor.querySelector('#__fe_save'); const cancelBtn = editor.querySelector('#__fe_cancel'); const closeBtn = editor.querySelector('#__fe_close'); if(nameIn) nameIn.focus(); if(roleSwitch) roleSwitch.addEventListener('change', ()=>{ if(roleLabel) roleLabel.textContent = roleSwitch.checked ? 'Master' : 'Worker'; }); const onKeyDown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); saveBtn && saveBtn.click(); } else if(e.key==='Escape'){ e.preventDefault(); cleanup(); } }; const onPointerDownOutside = (ev)=>{ if(editor.contains(ev.target)) return; cleanup(); }; function cleanup(){ try{ if(nameIn) nameIn.removeEventListener('keydown', onKeyDown); if(ipIn) ipIn.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDownOutside, true); }catch(e){} if(!editor) return; editor.classList.remove('show'); setTimeout(()=>{ if(editor.parentNode) editor.remove(); },220); } if(nameIn) nameIn.addEventListener('keydown', onKeyDown); if(ipIn) ipIn.addEventListener('keydown', onKeyDown); document.addEventListener('pointerdown', onPointerDownOutside, true); saveBtn.addEventListener('click', ()=>{ const newName = nameIn.value.trim(); const newIP = ipIn.value.trim(); const newRole = roleSwitch.checked ? 'master' : 'worker'; if(!newName||!newIP){ showToast('Name and IP cannot be empty'); return; } const vm = vms.find(n=>n.name===name); if(!vm){ cleanup(); return; } const oldRole = vm.role; if(primordialMaster===vm.name && newRole==='worker') primordialMaster=null; vm.name=newName; vm.ip=newIP; vm.role=newRole; if(newRole==='master' && oldRole==='worker'){ const existingMasters = vms.filter(v=>v.role==='master' && v.name!==newName).length; if(existingMasters===0) primordialMaster=newName; } cleanup(); renderVMList(); showToast('Node updated'); }); cancelBtn.addEventListener('click', ()=>{ cleanup(); }); if(closeBtn) closeBtn.addEventListener('click', ()=>{ cleanup(); }); }

document.addEventListener('DOMContentLoaded', ()=>{ try{ setupHandlers(); updateGenerateState(); renderTopology(); renderVMList(); }catch(e){ console.error('init error',e); showToast('Frontend initialization error'); } });
