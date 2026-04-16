// ── Tab navigation & bubble indicator ────────────────────────────────

let activeTabIndex = 0;

function updateProceedButton() {
  const proceedBtn = document.getElementById('proceedToTest');
  if (!proceedBtn) return;
  proceedBtn.disabled = !inventoryExists;
  updateTabStates();
}

const updateBubblePosition = (element) => {
  const bubble = document.getElementById('bubbleIndicator');
  const nav    = document.getElementById('tabNavigation');
  if (!bubble || !nav || !element) return;
  const navRect     = nav.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const padding = 4;
  bubble.style.left   = `${elementRect.left - navRect.left - padding}px`;
  bubble.style.top    = `${elementRect.top  - navRect.top  - padding}px`;
  bubble.style.width  = `${elementRect.width  + padding * 2}px`;
  bubble.style.height = `${elementRect.height + padding * 2}px`;
};

const updateTabStates = () => {
  const navList = document.getElementById('navList');
  if (!navList) return;
  const tabItems = navList.querySelectorAll('li');

  const connectionsTab = tabItems[1];
  if (connectionsTab) {
    if (inventoryExists) {
      connectionsTab.classList.remove('disabled');
      connectionsTab.style.pointerEvents = 'auto';
      connectionsTab.style.opacity = '1';
      connectionsTab.removeAttribute('title');
    } else {
      connectionsTab.classList.add('disabled');
      connectionsTab.style.pointerEvents = 'none';
      connectionsTab.style.opacity = '0.4';
      connectionsTab.title = 'Generate or detect an inventory first';
    }
  }

  const deployTab = tabItems[2];
  if (deployTab) {
    if (allConnectionsPass) {
      deployTab.classList.remove('disabled');
      deployTab.style.pointerEvents = 'auto';
      deployTab.style.opacity = '1';
      deployTab.removeAttribute('title');
    } else {
      deployTab.classList.add('disabled');
      deployTab.style.pointerEvents = 'none';
      deployTab.style.opacity = '0.4';
      deployTab.title = 'Complete connection tests successfully first';
    }
  }
};

function switchTab(tabName) {
  const stepLabels = { inventory: 'Step 1 of 3 — Inventory', connections: 'Step 2 of 3 — Test Connections', deploy: 'Step 3 of 3 — Deploy' };
  const progress = document.getElementById('stepProgress');
  if (progress && stepLabels[tabName]) progress.textContent = stepLabels[tabName];

  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  document.querySelectorAll('[data-tab-content]').forEach(content => {
    content.style.display = content.getAttribute('data-tab-content') === tabName ? 'block' : 'none';
  });

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

function switchToConnectionView() {
  switchTab('connections');
}

function switchToInventoryView() {
  switchTab('inventory');
  const results = document.getElementById('connectionResults');
  if (results) results.style.display = 'none';
}
