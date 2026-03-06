// Client-side state
let vms = [];
let primordialMaster = null;
let inventoryExists = false;
let deletedVMs = []; // Track VMs to delete on next generate
let allConnectionsPass = false; // Track if all connection tests passed
let clusterDeployed = false;    // Track if a cluster was successfully deployed
let _eventSource = null;        // active SSE connection

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

  // ── Deploy tab button wiring ──
  const startDeployBtn = document.getElementById('startDeploy');
  if (startDeployBtn) startDeployBtn.addEventListener('click', () => {
    if (clusterDeployed) {
      showToast('⚠️ A cluster is already deployed. Uninstall first before redeploying.', 4000);
      return;
    }
    startDeploy();
  });

  const abortDeployBtn = document.getElementById('abortDeploy');
  if (abortDeployBtn) abortDeployBtn.addEventListener('click', () => abortDeploy());

  const uninstallBtn = document.getElementById('uninstallCluster');
  if (uninstallBtn) uninstallBtn.addEventListener('click', () => startUninstall());

  const redeployBtn = document.getElementById('redeployCluster');
  if (redeployBtn) redeployBtn.addEventListener('click', () => {
    clusterDeployed = false;
    _showDeployIdle();
  });

  const abortUninstallBtn = document.getElementById('abortUninstall');
  if (abortUninstallBtn) abortUninstallBtn.addEventListener('click', () => {
    showConfirmToast('Abort the running uninstall?', async () => {
      try { await fetch('/deploy-abort', { method: 'POST' }); } catch(e) { showToast('Failed to abort'); }
    });
  });

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

// ── Deploy / Uninstall helpers ──────────────────────────────────────────

const STEP_ICONS = {
  docker: '🐳', primordial: '👑', kubeconfig: '🔑', masters: '🖥️', workers: '⚙️',
  pre_tasks: '🧹',
};
const DONE_ICON = '✓';
const FAIL_ICON = '✕';

function _getSSHCreds() {
  const username = document.getElementById('sshUsername')?.value.trim() || '';
  const sshKey = document.getElementById('sshKey')?.value.trim() || '';
  return { username, sshKey };
}

function _renderStepCards(container, steps) {
  container.innerHTML = '';
  steps.forEach(s => {
    const card = document.createElement('div');
    card.className = 'step-card pending';
    card.id = `step-${s.id}`;
    card.innerHTML = `<div class="step-icon">${STEP_ICONS[s.id] || '📦'}</div><div class="step-label">${escapeHtml(s.label)}</div><div class="step-task"></div>`;
    container.appendChild(card);
  });
}

function _setCardState(stepId, state, taskText) {
  const card = document.getElementById(`step-${stepId}`);
  if (!card) return;
  card.className = `step-card ${state}`;
  const icon = card.querySelector('.step-icon');
  if (state === 'done' && icon) icon.textContent = DONE_ICON;
  if (state === 'failed' && icon) icon.textContent = FAIL_ICON;
  if (taskText !== undefined) {
    const taskEl = card.querySelector('.step-task');
    if (taskEl) taskEl.textContent = taskText;
  }
}

function _showDeployIdle() {
  document.getElementById('deployIdle').style.display = '';
  document.getElementById('deployRunning').style.display = 'none';
  document.getElementById('uninstallRunning').style.display = 'none';
}

function _showDeployRunning() {
  document.getElementById('deployIdle').style.display = 'none';
  document.getElementById('deployRunning').style.display = '';
  document.getElementById('uninstallRunning').style.display = 'none';
  document.getElementById('abortDeploy').style.display = '';
  document.getElementById('uninstallCluster').style.display = 'none';
  document.getElementById('redeployCluster').style.display = 'none';
  document.getElementById('deployTitle').textContent = 'Deploying…';
  document.getElementById('deploySubtitle').textContent = 'Running the k3s-install playbook';
}

function _showUninstallRunning() {
  document.getElementById('deployIdle').style.display = 'none';
  document.getElementById('deployRunning').style.display = 'none';
  document.getElementById('uninstallRunning').style.display = '';
  document.getElementById('abortUninstall').style.display = '';
  document.getElementById('uninstallTitle').textContent = 'Uninstalling…';
  document.getElementById('uninstallSubtitle').textContent = 'Running the k3s-uninstall playbook';
}

function startDeploy() {
  const { username, sshKey } = _getSSHCreds();
  if (!username || !sshKey) {
    showToast('⚠️ SSH credentials from the connection tab are required.', 4000);
    return;
  }

  _showDeployRunning();

  const container = document.getElementById('deploySteps');
  container.innerHTML = '<div style="color:rgba(255,255,255,0.5);text-align:center;">Connecting…</div>';

  const params = new URLSearchParams({ username, ssh_key: sshKey });
  const es = new EventSource(`/deploy?${params.toString()}`);
  _eventSource = es;

  es.onmessage = (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch { return; }

    if (data.type === 'steps') {
      _renderStepCards(container, data.steps);
      return;
    }

    if (data.type === 'step_start') {
      _setCardState(data.step, 'active', '');
      return;
    }

    if (data.type === 'step_done') {
      _setCardState(data.step, 'done');
      return;
    }

    if (data.type === 'task') {
      _setCardState(data.step, 'active', data.task);
      return;
    }

    if (data.type === 'task_warning') {
      _setCardState(data.step, 'active', '⚠ ' + (data.msg || '').slice(0, 80));
      return;
    }

    if (data.type === 'step_failed') {
      _setCardState(data.step, 'failed', 'Failed');
      return;
    }

    if (data.type === 'finished') {
      es.close();
      _eventSource = null;
      document.getElementById('abortDeploy').style.display = 'none';
      if (data.success) {
        clusterDeployed = true;
        document.getElementById('deployTitle').textContent = '✅ Cluster Deployed';
        document.getElementById('deploySubtitle').textContent = 'All roles completed successfully';
        document.getElementById('uninstallCluster').style.display = '';
        showToast('🎉 K3s cluster deployed successfully!', 5000);
      } else if (data.aborted) {
        document.getElementById('deployTitle').textContent = '⛔ Deployment Aborted';
        document.getElementById('deploySubtitle').textContent = 'The process was cancelled by the user';
        document.getElementById('redeployCluster').style.display = '';
        // Mark remaining active cards as aborted
        container.querySelectorAll('.step-card.active').forEach(c => c.className = 'step-card aborted');
        container.querySelectorAll('.step-card.pending').forEach(c => c.className = 'step-card aborted');
      } else {
        document.getElementById('deployTitle').textContent = '❌ Deployment Failed';
        document.getElementById('deploySubtitle').textContent = 'Check the step that failed for details';
        document.getElementById('redeployCluster').style.display = '';
        // Mark remaining pending cards
        container.querySelectorAll('.step-card.pending').forEach(c => c.className = 'step-card aborted');
      }
      return;
    }

    if (data.type === 'error') {
      es.close();
      _eventSource = null;
      showToast('❌ ' + (data.msg || 'Unknown error'), 5000);
      document.getElementById('abortDeploy').style.display = 'none';
      document.getElementById('redeployCluster').style.display = '';
      document.getElementById('deployTitle').textContent = '❌ Error';
      document.getElementById('deploySubtitle').textContent = data.msg || '';
    }
  };

  es.onerror = () => {
    es.close();
    _eventSource = null;
    // Only show error if we haven't already shown a finished message
    const title = document.getElementById('deployTitle')?.textContent || '';
    if (!title.includes('✅') && !title.includes('❌') && !title.includes('⛔')) {
      document.getElementById('abortDeploy').style.display = 'none';
      document.getElementById('redeployCluster').style.display = '';
      document.getElementById('deployTitle').textContent = '❌ Connection Lost';
      document.getElementById('deploySubtitle').textContent = 'The SSE stream was interrupted';
    }
  };
}

function abortDeploy() {
  showConfirmToast('Abort the running deployment?', async () => {
    try {
      await fetch('/deploy-abort', { method: 'POST' });
    } catch(e) {
      showToast('Failed to send abort signal');
    }
  });
}

function startUninstall() {
  const { username, sshKey } = _getSSHCreds();
  if (!username || !sshKey) {
    showToast('⚠️ SSH credentials from the connection tab are required.', 4000);
    return;
  }

  showConfirmToast('Uninstall the K3s cluster from all nodes?', () => {
    _showUninstallRunning();

    const container = document.getElementById('uninstallSteps');
    container.innerHTML = '<div style="color:rgba(255,255,255,0.5);text-align:center;">Connecting…</div>';

    const params = new URLSearchParams({ username, ssh_key: sshKey });
    const es = new EventSource(`/uninstall?${params.toString()}`);
    _eventSource = es;

    es.onmessage = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }

      if (data.type === 'steps') { _renderStepCards(container, data.steps); return; }
      if (data.type === 'step_start') { _setCardState(data.step, 'active', ''); return; }
      if (data.type === 'step_done') { _setCardState(data.step, 'done'); return; }
      if (data.type === 'task') { _setCardState(data.step, 'active', data.task); return; }
      if (data.type === 'task_warning') { _setCardState(data.step, 'active', '⚠ ' + (data.msg||'').slice(0,80)); return; }
      if (data.type === 'step_failed') { _setCardState(data.step, 'failed', 'Failed'); return; }

      if (data.type === 'finished') {
        es.close();
        _eventSource = null;
        document.getElementById('abortUninstall').style.display = 'none';

        if (data.success) {
          clusterDeployed = false;
          document.getElementById('uninstallTitle').textContent = '✅ Cluster Uninstalled';
          document.getElementById('uninstallSubtitle').textContent = 'All nodes cleaned up successfully';
          showToast('Cluster uninstalled.', 4000);
          // After 2s return to idle deploy view
          setTimeout(() => { _showDeployIdle(); }, 2500);
        } else if (data.aborted) {
          document.getElementById('uninstallTitle').textContent = '⛔ Uninstall Aborted';
          document.getElementById('uninstallSubtitle').textContent = 'Cancelled by user';
          container.querySelectorAll('.step-card.active, .step-card.pending').forEach(c => c.className = 'step-card aborted');
          setTimeout(() => {
            document.getElementById('deployRunning').style.display = '';
            document.getElementById('uninstallRunning').style.display = 'none';
          }, 2500);
        } else {
          document.getElementById('uninstallTitle').textContent = '❌ Uninstall Failed';
          document.getElementById('uninstallSubtitle').textContent = 'Check the step that failed';
          container.querySelectorAll('.step-card.pending').forEach(c => c.className = 'step-card aborted');
        }
        return;
      }

      if (data.type === 'error') {
        es.close();
        _eventSource = null;
        showToast('❌ ' + (data.msg || 'Unknown error'), 5000);
        document.getElementById('abortUninstall').style.display = 'none';
        document.getElementById('uninstallTitle').textContent = '❌ Error';
        document.getElementById('uninstallSubtitle').textContent = data.msg || '';
      }
    };

    es.onerror = () => {
      es.close();
      _eventSource = null;
      const title = document.getElementById('uninstallTitle')?.textContent || '';
      if (!title.includes('✅') && !title.includes('❌') && !title.includes('⛔')) {
        document.getElementById('abortUninstall').style.display = 'none';
        document.getElementById('uninstallTitle').textContent = '❌ Connection Lost';
        document.getElementById('uninstallSubtitle').textContent = 'The SSE stream was interrupted';
      }
    };
  });
}

function openTopoEditor(name){ const node=vms.find(n=>n.name===name); if(!node) return; const container=document.getElementById('topology'); if(!container) return; const svg=container.querySelector('svg'); if(!svg) return; const existing=document.querySelector('.floating-editor'); if(existing) existing.remove(); const bboxNode = Array.from(svg.querySelectorAll('g')).find(g=>g.getAttribute('data-name')===name); if(!bboxNode) return; const bbox=bboxNode.getBBox(); const svgRect=svg.getBoundingClientRect(); const viewBox=svg.getAttribute('viewBox')?.split(' ').map(Number) || [0,0,svgRect.width,svgRect.height]; const vbW=viewBox[2]||svgRect.width; const vbH=viewBox[3]||svgRect.height; const scaleX=svgRect.width/vbW; const scaleY=svgRect.height/vbH; const clientX=Math.round(svgRect.left + bbox.x*scaleX + window.scrollX); const clientY=Math.round(svgRect.top + bbox.y*scaleY + window.scrollY); const clientW=Math.round(bbox.width*scaleX); const clientH=Math.round(bbox.height*scaleY); const editor=document.createElement('div'); editor.className='floating-editor inline-editor-fo'; editor.style.position='absolute'; editor.style.zIndex=99999; editor.style.pointerEvents='auto'; const effectiveWidth=Math.min(320, Math.max(280, Math.round(Math.min(window.innerWidth-48, svgRect.width*0.5)))); const effectiveHeight=Math.max(180, Math.round(Math.min(300, svgRect.height*0.5))); const viewportWidth = window.innerWidth + window.scrollX; const viewportHeight = window.innerHeight + window.scrollY; let px = clientX + clientW + 12; let py = clientY; if(px + effectiveWidth > viewportWidth - 12){ const leftX=clientX - effectiveWidth - 12; if(leftX>=window.scrollX + 12) px = leftX; else { px = Math.round(clientX + clientW/2 - effectiveWidth/2); if(px<window.scrollX + 12) px=window.scrollX + 12; if(px+effectiveWidth>viewportWidth-12) px=viewportWidth-effectiveWidth-12; py = clientY + clientH + 12; } } const currentViewportBottom = window.scrollY + window.innerHeight; if(py + effectiveHeight > currentViewportBottom - 12){ py = Math.max(window.scrollY + 12, py - effectiveHeight - clientH - 24); if(py < window.scrollY + 12) py = window.scrollY + 12; } editor.style.left = px + 'px'; editor.style.top = py + 'px'; editor.style.width = effectiveWidth + 'px'; editor.style.minHeight = effectiveHeight + 'px'; editor.innerHTML = `<div style="position:relative; background:#0b0b0b; padding:10px 12px 12px 12px; padding-top:34px; border-radius:8px; border:1px solid #6366f1; box-shadow:0 14px 40px rgba(0,0,0,0.6);"> <button id="__fe_close" aria-label="Close" style="position:absolute; right:8px; top:8px; background:transparent; border:none; color:#fff; font-size:20px; opacity:0.9; cursor:pointer; padding:2px 6px;">×</button> <div style="margin-bottom:8px;"><input id="__fe_name" class="svg-fo-input" placeholder="Name" value="${escapeHtml(node.name)}"></div> <div style="margin-bottom:8px;"><input id="__fe_ip" class="svg-fo-input" placeholder="IP" value="${escapeHtml(node.ip)}"></div> <div style="margin-bottom:12px; display:flex; align-items:center; gap:10px; color:#fff;"><label class="switch"><input type="checkbox" id="__fe_roleswitch" ${node.role==='master'?'checked':''}><span class="slider"></span></label><span id="__fe_rolelabel">${node.role==='master'?'Master':'Worker'}</span></div> <div class="svg-fo-actions"><button id="__fe_save" class="primary" style="padding:6px 12px;">Save</button> <button id="__fe_cancel" style="padding:6px 10px; background:transparent; border:1px solid rgba(255,255,255,0.06); color:#fff; border-radius:6px;">Cancel</button></div> </div>`; document.body.appendChild(editor); requestAnimationFrame(()=>editor.classList.add('show')); const nameIn = editor.querySelector('#__fe_name'); const ipIn = editor.querySelector('#__fe_ip'); const roleSwitch = editor.querySelector('#__fe_roleswitch'); const roleLabel = editor.querySelector('#__fe_rolelabel'); const saveBtn = editor.querySelector('#__fe_save'); const cancelBtn = editor.querySelector('#__fe_cancel'); const closeBtn = editor.querySelector('#__fe_close'); if(nameIn) nameIn.focus(); if(roleSwitch) roleSwitch.addEventListener('change', ()=>{ if(roleLabel) roleLabel.textContent = roleSwitch.checked ? 'Master' : 'Worker'; }); const onKeyDown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); saveBtn && saveBtn.click(); } else if(e.key==='Escape'){ e.preventDefault(); cleanup(); } }; const onPointerDownOutside = (ev)=>{ if(editor.contains(ev.target)) return; cleanup(); }; function cleanup(){ try{ if(nameIn) nameIn.removeEventListener('keydown', onKeyDown); if(ipIn) ipIn.removeEventListener('keydown', onKeyDown); document.removeEventListener('pointerdown', onPointerDownOutside, true); }catch(e){} if(!editor) return; editor.classList.remove('show'); setTimeout(()=>{ if(editor.parentNode) editor.remove(); },220); } if(nameIn) nameIn.addEventListener('keydown', onKeyDown); if(ipIn) ipIn.addEventListener('keydown', onKeyDown); document.addEventListener('pointerdown', onPointerDownOutside, true); saveBtn.addEventListener('click', ()=>{ const newName = nameIn.value.trim(); const newIP = ipIn.value.trim(); const newRole = roleSwitch.checked ? 'master' : 'worker'; if(!newName||!newIP){ showToast('Name and IP cannot be empty'); return; } const vm = vms.find(n=>n.name===name); if(!vm){ cleanup(); return; } const oldRole = vm.role; if(primordialMaster===vm.name && newRole==='worker') primordialMaster=null; vm.name=newName; vm.ip=newIP; vm.role=newRole; if(newRole==='master' && oldRole==='worker'){ const existingMasters = vms.filter(v=>v.role==='master' && v.name!==newName).length; if(existingMasters===0) primordialMaster=newName; } cleanup(); renderVMList(); showToast('Node updated'); }); cancelBtn.addEventListener('click', ()=>{ cleanup(); }); if(closeBtn) closeBtn.addEventListener('click', ()=>{ cleanup(); }); }

document.addEventListener('DOMContentLoaded', ()=>{ try{ setupHandlers(); updateGenerateState(); renderTopology(); renderVMList(); initWelcomeScreen(); }catch(e){ console.error('init error',e); showToast('Frontend initialization error'); } });

// ── Welcome Screen & Existing Cluster flow ────────────────────────────

// Cached data so switching tabs doesn't re-fetch unnecessarily
let _clusterData = { nodes: null, pods: null, services: null, nodeResources: null };
let _activeClusterSection = 'overview';

function _goHome() {
  document.getElementById('mainContainer').style.display = 'none';
  document.getElementById('existingContainer').style.display = 'none';
  document.getElementById('welcomeScreen').style.display = '';
  _clusterData = { nodes: null, pods: null, services: null, nodeResources: null };
  document.getElementById('btnHomeFixed').style.display = 'none';
}

function initWelcomeScreen() {
  const btnCreate   = document.getElementById('btnCreateCluster');
  const btnExisting = document.getElementById('btnExistingCluster');

  if (btnCreate) {
    btnCreate.addEventListener('click', () => {
      document.getElementById('welcomeScreen').style.display = 'none';
      document.getElementById('mainContainer').style.display = '';
      document.getElementById('btnHomeFixed').style.display = '';
    });
  }

  if (btnExisting) {
    btnExisting.addEventListener('click', () => {
      document.getElementById('welcomeScreen').style.display = 'none';
      document.getElementById('existingContainer').style.display = '';
      document.getElementById('btnHomeFixed').style.display = '';
    });
  }

  const btnBackToWelcome = document.getElementById('btnBackToWelcome');
  if (btnBackToWelcome) {
    btnBackToWelcome.addEventListener('click', () => {
      document.getElementById('existingContainer').style.display = 'none';
      document.getElementById('welcomeScreen').style.display = '';
      document.getElementById('btnHomeFixed').style.display = 'none';
    });
  }

  const btnHomeFixed = document.getElementById('btnHomeFixed');
  if (btnHomeFixed) {
    btnHomeFixed.addEventListener('click', () => {
      if (_eventSource) {
        showConfirmToast('A process is still running. Go home anyway?', () => {
          if (_eventSource) { _eventSource.close(); _eventSource = null; }
          _goHome();
        });
      } else {
        _goHome();
      }
    });
  }

  const btnProceed = document.getElementById('btnProceedKubeconfig');
  if (btnProceed) {
    btnProceed.addEventListener('click', () => enterClusterDashboard());
  }

  const btnBackToKubeconfig = document.getElementById('btnBackToKubeconfig');
  if (btnBackToKubeconfig) {
    btnBackToKubeconfig.addEventListener('click', () => {
      document.getElementById('clusterDashboard').style.display = 'none';
      document.getElementById('kubeconfigView').style.display = '';
      _clusterData = { nodes: null, pods: null, services: null };
    });
  }

  const btnRefresh = document.getElementById('btnRefreshSection');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => refreshCurrentSection());
  }

  // Cluster navbar tab switching
  const clusterNavList = document.getElementById('clusterNavList');
  if (clusterNavList) {
    clusterNavList.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        switchClusterSection(li.dataset.section);
        updateClusterNavBubble(li);
      });
    });
  }

  // Namespace filter
  const nsFilter = document.getElementById('nsFilter');
  if (nsFilter) {
    nsFilter.addEventListener('change', () => {
      if (_clusterData.pods) {
        renderPodsTable(_clusterData.pods.headers, _clusterData.pods.rows);
      }
    });
  }
}

// ── Enter dashboard: show it, load all three data sets in parallel ──────
async function enterClusterDashboard() {
  const kubeconfig = document.getElementById('kubeconfigInput')?.value.trim();
  if (!kubeconfig) { showToast('Please paste your kubeconfig first.'); return; }

  const btn = document.getElementById('btnProceedKubeconfig');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }

  try {
    document.getElementById('kubeconfigView').style.display = 'none';
    document.getElementById('clusterDashboard').style.display = '';

    _clusterData = { nodes: null, pods: null, services: null, nodeResources: null };
    _activeClusterSection = 'overview';
    switchClusterSection('overview', false);
    initClusterNavBubble();

    setTableLoading('nodesTableContainer');
    setTableLoading('podsTableContainer');
    setTableLoading('servicesTableContainer');
    document.getElementById('nodeResourcesContainer').innerHTML = '<div class="nrc-loading"><span class="cluster-spinner"></span>Loading resource metrics…</div>';

    const [nodesRes, podsRes, svcRes, resourcesRes] = await Promise.all([
      fetchKubectl('/kubectl-nodes', kubeconfig),
      fetchKubectl('/kubectl-pods', kubeconfig),
      fetchKubectl('/kubectl-services', kubeconfig),
      fetchKubectl('/kubectl-node-resources', kubeconfig),
    ]);

    handleNodesData(nodesRes);
    handlePodsData(podsRes);
    handleServicesData(svcRes);
    handleNodeResourcesData(resourcesRes);

  } catch (e) {
    showToast('Network error while loading cluster info.');
    console.error(e);
    document.getElementById('clusterDashboard').style.display = 'none';
    document.getElementById('kubeconfigView').style.display = '';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Proceed'; }
  }
}

async function fetchKubectl(endpoint, kubeconfig) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kubeconfig }),
  });
  return res.json();
}

async function refreshCurrentSection() {
  const kubeconfig = document.getElementById('kubeconfigInput')?.value.trim();
  if (!kubeconfig) { showToast('Kubeconfig missing.'); return; }

  const btn = document.getElementById('btnRefreshSection');
  if (btn) { btn.disabled = true; }

  const section = _activeClusterSection;
  const endpointMap = { overview: '/kubectl-nodes', workloads: '/kubectl-pods', services: '/kubectl-services' };
  const containerMap = { overview: 'nodesTableContainer', workloads: 'podsTableContainer', services: 'servicesTableContainer' };

  setTableLoading(containerMap[section]);

  try {
    if (section === 'overview') {
      const nrcEl = document.getElementById('nodeResourcesContainer');
      if (nrcEl) nrcEl.innerHTML = '<div class="nrc-loading"><span class="cluster-spinner"></span>Loading resource metrics…</div>';
      const [json, resourcesJson] = await Promise.all([
        fetchKubectl('/kubectl-nodes', kubeconfig),
        fetchKubectl('/kubectl-node-resources', kubeconfig),
      ]);
      handleNodesData(json);
      handleNodeResourcesData(resourcesJson);
    } else {
      const json = await fetchKubectl(endpointMap[section], kubeconfig);
      if (section === 'workloads') handlePodsData(json);
      else if (section === 'services') handleServicesData(json);
    }
  } catch (e) {
    showToast('Refresh failed.');
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

// ── Data handlers ─────────────────────────────────────────────────────
function handleNodesData(json) {
  if (json.status === 'error') {
    setTableError('nodesTableContainer', json.message);
    document.getElementById('overviewSubtitle').textContent = 'Error loading nodes';
    return;
  }
  _clusterData.nodes = json;
  renderClusterTable('nodesTableContainer', json.headers, json.rows, 'STATUS');
  const sub = document.getElementById('overviewSubtitle');
  if (sub) sub.textContent = `${json.rows.length} node${json.rows.length !== 1 ? 's' : ''}`;
}

function handlePodsData(json) {
  if (json.status === 'error') {
    setTableError('podsTableContainer', json.message);
    document.getElementById('workloadsSubtitle').textContent = 'Error loading pods';
    return;
  }
  _clusterData.pods = json;
  populateNamespaceFilter(json.rows, json.headers);
  renderPodsTable(json.headers, json.rows);
}

function handleServicesData(json) {
  if (json.status === 'error') {
    setTableError('servicesTableContainer', json.message);
    document.getElementById('servicesSubtitle').textContent = 'Error loading services';
    return;
  }
  _clusterData.services = json;
  renderClusterTable('servicesTableContainer', json.headers, json.rows);
  const sub = document.getElementById('servicesSubtitle');
  if (sub) sub.textContent = `${json.rows.length} service${json.rows.length !== 1 ? 's' : ''}`;
}

function handleNodeResourcesData(json) {
  const container = document.getElementById('nodeResourcesContainer');
  if (!container) return;
  if (!json || json.status === 'error' || !json.nodes?.length) {
    container.innerHTML = '';
    return;
  }
  _clusterData.nodeResources = json;
  renderNodeResourceCards(json);
}

function renderNodeResourceCards(resourcesData) {
  const container = document.getElementById('nodeResourcesContainer');
  if (!container || !resourcesData?.nodes?.length) return;

  // Count pods per node using already-loaded pods data
  const podRows    = _clusterData.pods?.rows    || [];
  const podHeaders = _clusterData.pods?.headers || [];
  const nodeCol    = podHeaders.indexOf('NODE');
  const podCountPerNode = {};
  if (nodeCol !== -1) {
    podRows.forEach(row => {
      const node = row[nodeCol];
      if (node && node !== '<none>') podCountPerNode[node] = (podCountPerNode[node] || 0) + 1;
    });
  }

  const grid = document.createElement('div');
  grid.className = 'node-resources-grid';

  resourcesData.nodes.forEach(node => {
    const card = document.createElement('div');
    card.className = 'node-resource-card';

    const podsUsed = podCountPerNode[node.name] || 0;
    const podsMax  = node.pods_allocatable || 110;
    const podsPct  = Math.min(100, Math.round((podsUsed / podsMax) * 100));

    let cpuHtml, memHtml;
    if (node.metrics_available && node.cpu_percent !== null) {
      const cpuPct = parseFloat(node.cpu_percent) || 0;
      const memPct = parseFloat(node.memory_percent) || 0;
      cpuHtml = `
        <div class="nrc-metric">
          <div class="nrc-metric-label"><span>CPU</span><span class="nrc-metric-value">${escapeHtml(node.cpu_used)} / ${escapeHtml(_formatCpuAllocatable(node.cpu_allocatable))}</span></div>
          <div class="nrc-bar-track"><div class="nrc-bar-fill ${_barClass(cpuPct)}" style="width:${cpuPct}%"></div></div>
          <span class="nrc-pct">${cpuPct}%</span>
        </div>`;
      memHtml = `
        <div class="nrc-metric">
          <div class="nrc-metric-label"><span>Memory</span><span class="nrc-metric-value">${escapeHtml(_formatMemory(node.memory_used))} / ${escapeHtml(_formatMemory(node.memory_allocatable))}</span></div>
          <div class="nrc-bar-track"><div class="nrc-bar-fill ${_barClass(memPct)}" style="width:${memPct}%"></div></div>
          <span class="nrc-pct">${memPct}%</span>
        </div>`;
    } else {
      cpuHtml = `
        <div class="nrc-metric">
          <div class="nrc-metric-label"><span>CPU</span><span class="nrc-metric-value nrc-dim">Allocatable: ${escapeHtml(_formatCpuAllocatable(node.cpu_allocatable))}</span></div>
          <div class="nrc-no-metrics">metrics-server unavailable</div>
        </div>`;
      memHtml = `
        <div class="nrc-metric">
          <div class="nrc-metric-label"><span>Memory</span><span class="nrc-metric-value nrc-dim">Allocatable: ${escapeHtml(_formatMemory(node.memory_allocatable))}</span></div>
          <div class="nrc-no-metrics">metrics-server unavailable</div>
        </div>`;
    }

    const podsHtml = `
      <div class="nrc-metric">
        <div class="nrc-metric-label"><span>Pods</span><span class="nrc-metric-value">${podsUsed} / ${podsMax}</span></div>
        <div class="nrc-bar-track"><div class="nrc-bar-fill ${_barClass(podsPct)}" style="width:${podsPct}%"></div></div>
        <span class="nrc-pct">${podsPct}%</span>
      </div>`;

    card.innerHTML = `
      <div class="nrc-header">
        <span class="nrc-name">${escapeHtml(node.name)}</span>
        <span class="nrc-role nrc-role-${escapeHtml(node.role)}">${escapeHtml(node.role.toUpperCase())}</span>
      </div>
      ${cpuHtml}${memHtml}${podsHtml}`;

    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

function _barClass(pct) {
  if (pct >= 85) return 'bar-critical';
  if (pct >= 60) return 'bar-warn';
  return 'bar-ok';
}

function _formatCpuAllocatable(cpu) {
  if (!cpu) return 'N/A';
  if (cpu.endsWith('m')) {
    const cores = parseFloat(cpu) / 1000;
    return cores >= 1 ? `${cores % 1 === 0 ? cores : cores.toFixed(1)} cores` : cpu;
  }
  const n = parseFloat(cpu);
  return isNaN(n) ? cpu : `${n} core${n !== 1 ? 's' : ''}`;
}

function _formatMemory(mem) {
  if (!mem) return 'N/A';
  if (mem.endsWith('Mi')) {
    const mb = parseFloat(mem);
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GiB` : `${mb.toFixed(0)} MiB`;
  }
  if (mem.endsWith('Ki')) {
    const kb = parseFloat(mem);
    const gb = kb / (1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GiB` : `${(kb / 1024).toFixed(0)} MiB`;
  }
  if (mem.endsWith('Gi')) return `${parseFloat(mem).toFixed(1)} GiB`;
  const n = parseFloat(mem);
  if (!isNaN(n)) {
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GiB`;
    if (n >= 1048576)    return `${(n / 1048576).toFixed(0)} MiB`;
  }
  return mem;
}

// ── Namespace filter helpers ──────────────────────────────────────────
function populateNamespaceFilter(rows, headers) {
  const nsIndex = headers.indexOf('NAMESPACE');
  const select = document.getElementById('nsFilter');
  if (!select || nsIndex === -1) return;

  const namespaces = [...new Set(rows.map(r => r[nsIndex]).filter(Boolean))].sort();
  const currentVal = select.value;
  select.innerHTML = '<option value="">All namespaces</option>';
  namespaces.forEach(ns => {
    const opt = document.createElement('option');
    opt.value = ns;
    opt.textContent = ns;
    if (ns === currentVal) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderPodsTable(headers, rows) {
  const nsIndex   = headers.indexOf('NAMESPACE');
  const nameIndex = headers.indexOf('NAME');
  const filterVal = document.getElementById('nsFilter')?.value || '';

  const filteredRows = filterVal && nsIndex !== -1
    ? rows.filter(r => r[nsIndex] === filterVal)
    : rows;

  // Columns to hide entirely
  const PODS_HIDDEN = new Set(['NOMINATED', 'NODE', 'READINESS', 'GATES']);

  // Reorder columns: NAME first, NAMESPACE second, then everything else (minus hidden cols)
  let orderedHeaders = headers;
  let orderedRows    = filteredRows;
  if (nsIndex !== -1 && nameIndex !== -1 && nsIndex !== nameIndex) {
    const desired = ['NAME', 'NAMESPACE', ...headers.filter(h => h !== 'NAME' && h !== 'NAMESPACE' && !PODS_HIDDEN.has(h))];
    const idxMap  = desired.map(h => headers.indexOf(h)).filter(i => i !== -1);
    orderedHeaders = idxMap.map(i => headers[i]);
    orderedRows    = filteredRows.map(r => idxMap.map(i => r[i] ?? '<none>'));
  } else {
    // Fallback: still strip hidden columns even if order wasn't swapped
    const idxMap  = headers.map((h, i) => i).filter(i => !PODS_HIDDEN.has(headers[i]));
    orderedHeaders = idxMap.map(i => headers[i]);
    orderedRows    = filteredRows.map(r => idxMap.map(i => r[i] ?? '<none>'));
  }

  renderClusterTable('podsTableContainer', orderedHeaders, orderedRows, 'STATUS');

  const sub = document.getElementById('workloadsSubtitle');
  if (sub) {
    sub.textContent = filterVal
      ? `${filteredRows.length} pod${filteredRows.length !== 1 ? 's' : ''} in "${filterVal}"`
      : `${filteredRows.length} pod${filteredRows.length !== 1 ? 's' : ''} across all namespaces`;
  }
}

// ── Generic table renderer ────────────────────────────────────────────
function renderClusterTable(containerId, headers, rows, statusCol) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!headers.length || !rows.length) {
    container.innerHTML = '<div class="cluster-table-msg">No data returned.</div>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'nodes-table';

  // thead
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headers.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // tbody
  const statusIdx = statusCol ? headers.indexOf(statusCol) : -1;
  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    row.forEach((cell, i) => {
      const td = document.createElement('td');
      td.textContent = cell;
      if (i === statusIdx) {
        const v = cell.toLowerCase();
        if (v === 'ready' || v === 'running' || v === 'active') td.className = 'status-ready';
        else if (v !== '<none>' && v !== 'completed' && v !== 'succeeded') td.className = 'status-notready';
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

// ── Loading / error states ────────────────────────────────────────────
function setTableLoading(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '<div class="cluster-table-msg"><span class="cluster-spinner"></span>Loading…</div>';
}

function setTableError(containerId, msg) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="cluster-table-msg" style="color:#ef4444;">❌ ${escapeHtml(msg)}</div>`;
}

// ── Cluster navbar section switching ─────────────────────────────────
function switchClusterSection(sectionName, withBubble = true) {
  _activeClusterSection = sectionName;

  const navList = document.getElementById('clusterNavList');
  if (navList) {
    navList.querySelectorAll('li').forEach(li => {
      li.classList.toggle('active', li.dataset.section === sectionName);
    });
    if (withBubble) {
      const activeLi = navList.querySelector(`li[data-section="${sectionName}"]`);
      updateClusterNavBubble(activeLi);
    }
  }

  document.querySelectorAll('.cluster-section').forEach(sec => {
    sec.style.display = sec.dataset.section === sectionName ? '' : 'none';
  });
}

function updateClusterNavBubble(element) {
  const bubble = document.getElementById('clusterNavBubble');
  if (!bubble || !element) return;
  // The bubble is position:absolute inside .cluster-nav, so measure
  // offsets against the .cluster-nav element, not the inner <ul>.
  const navEl = element.closest('.cluster-nav');
  if (!navEl) return;

  const navRect = navEl.getBoundingClientRect();
  const elRect  = element.getBoundingClientRect();
  const pad = 2;
  bubble.style.left   = `${elRect.left - navRect.left - pad}px`;
  bubble.style.top    = `${elRect.top  - navRect.top  - pad}px`;
  bubble.style.width  = `${elRect.width  + pad * 2}px`;
  bubble.style.height = `${elRect.height + pad * 2}px`;
}

// Position the bubble once the dashboard becomes visible
function initClusterNavBubble() {
  const navList = document.getElementById('clusterNavList');
  if (!navList) return;
  const activeLi = navList.querySelector('li.active');
  if (activeLi) setTimeout(() => updateClusterNavBubble(activeLi), 40);
}

