# Repository Context — K3sForge

Last updated: 2026-03-07
Maintainer (initial entry): GitHub Copilot (assistant)

## Short description
K3sForge is a collection of Ansible playbooks, scripts, and supporting files to install and manage lightweight Kubernetes (k3s) clusters, plus a small frontend for status/interaction. It includes HAProxy and MetalLB support and helper roles for Docker and node provisioning.

## Key areas of the repository
- `ansible/` — Ansible playbooks and roles to install/uninstall k3s, HAProxy, Docker, and retrieve kubeconfig.
- `core-services/metallb/` — scripts and YAML for MetalLB installation and IP pool configuration.
- `frontend/` — a minimal Python/Flask (or similar) app in `src/` with static assets and templates used for a UI.
- `Dockerfile`, `docker-compose.yml` — containerization and local service orchestration.
- `README.md` — high-level repo documentation and usage hints.

## Purpose / Goals
- Provide repeatable playbooks to provision a k3s cluster (masters + workers) and HAProxy for load balancing.
- Offer a lightweight frontend for status or orchestrator interactions.
- Be a single-source repo for cluster bootstrap automation and small demo workflows.

## Languages & Tools present
- Ansible (playbooks and roles)
- Bash scripts
- Python (frontend)
- JavaScript/CSS for static UI
- Docker/Docker Compose

## Where to look first
- For cluster installation flows: `ansible/playbooks/k3s-install.yaml` and the roles under `ansible/roles/`.
- For HAProxy config and install: `ansible/roles/haproxy-install/templates/haproxy.cfg` and related playbooks.
- For MetalLB setup: `core-services/metallb/install.sh` and `metallb-ip-pool.yaml`.

## Update policy for this context file
This file is intended to be a living summary that the assistant will append to as we make progress. Each entry should follow this format:

```
YYYY-MM-DD — Actor — Short description of change or observation
- Details (optional, 1-2 lines)
```

Examples of entries:
```
2026-02-06 — Assistant — Created initial context file summarizing repository.
- Added sections: short description, key areas, purpose, languages, where to look first, and update policy.
```

## Important rule — Clarification policy
The assistant will NOT make assumptions about intent or actions. Before performing any non-trivial change (code edits, runs, deployments, commits), the assistant will ask explicit clarifying questions and wait for user confirmation.

When you (the user) interact with the assistant, you can request:
- "Proceed" to allow a suggested change, or
- "Ask first" to require explicit step-by-step confirmation.

Current default: Ask first for clarifications and confirmation before taking actions.

## History
2026-02-06 — Assistant — Created initial context file.
- Summarized repository structure and set clarification policy.

2026-02-06 — Assistant — Implemented Deploy tab (Step 3 of the UI workflow).
- **Backend (`frontend/src/main.py`)**:
  - Added `GET /deploy` — SSE endpoint that streams `ansible-playbook k3s-install.yaml` progress in real time. Uses the SSH username and private key provided by the user in the Test Connections tab (passed via `--user` / `--private-key`), bypassing the hardcoded `ansible.cfg` credentials.
  - Added `POST /deploy-abort` — Sends `SIGTERM` to the running ansible process group to cleanly cancel a deploy or uninstall mid-flight.
  - Added `GET /uninstall` — SSE endpoint that streams `ansible-playbook k3s-uninstall.yaml` with the same user-provided SSH credentials.
  - Added `GET /deploy-status` — Quick poll endpoint returning the current process state (`idle` / `running` / `success` / `failed` / `aborted`).
  - SSH key is written to a temp file with `0600` permissions and auto-deleted after the playbook finishes.
  - New imports: `subprocess`, `signal`, `json`, `tempfile`, `queue`.
- **HTML (`frontend/src/templates/index.html`)**:
  - Replaced the "Coming Soon" placeholder in the Deploy tab with three views: Idle (big "Deploy Cluster" button), Running (animated step cards + Abort button), and Uninstall Running (separate step cards for teardown).
  - After successful deploy: shows "Uninstall Cluster" button; redeploy is blocked until uninstall completes.
  - After failure/abort: shows "Redeploy" button.
- **CSS (`frontend/src/static/style.css`)**:
  - Added step card styles with five visual states: `pending` (dimmed), `active` (pulsing icon + shimmer bar), `done` (green border + ✓), `failed` (red), `aborted` (amber).
  - Added styled abort button (red), uninstall button (amber), and deploy-specific layout classes.
  - Added `@keyframes spinPulse` and `@keyframes shimmer` animations.
- **JS (`frontend/src/static/script.js`)**:
  - Added `startDeploy()` — opens `EventSource` to `/deploy`, parses SSE step events, and animates cards in real time.
  - Added `startUninstall()` — same pattern against `/uninstall`.
  - Added `abortDeploy()` — confirmation toast then `POST /deploy-abort`.
  - Added helper functions: `_renderStepCards`, `_setCardState`, `_showDeployIdle`, `_showDeployRunning`, `_showUninstallRunning`, `_getSSHCreds`.
  - Deploy button guards: if `clusterDeployed === true`, user is told to uninstall first.
  - Wired all new buttons (`startDeploy`, `abortDeploy`, `uninstallCluster`, `redeployCluster`, `abortUninstall`) in `setupHandlers()`.
  - New client-side state variables: `clusterDeployed`, `_eventSource`.

---

If you'd like different naming, file location, or an alternate structured format (JSON/YAML), tell me which and I'll convert this file. If you want me to commit this to git and create a commit message, I can do that next (I'll ask before committing).

---

2026-03-07 — Assistant — Added per-node CPU/memory resource cards to the Existing Cluster — Overview section.
- **Backend (`frontend/src/main.py`)**:
  - Added `POST /kubectl-node-resources` — runs `kubectl get nodes -o json` to read allocatable CPU/memory/pods, then optionally runs `kubectl top nodes` (metrics-server) to get live usage. Returns a JSON payload with one entry per node: `name`, `role`, `cpu_allocatable`, `memory_allocatable`, `pods_allocatable`, `metrics_available`, `cpu_used`, `cpu_percent`, `memory_used`, `memory_percent`.
- **HTML (`frontend/src/templates/index.html`)**:
  - Added `<div id="nodeResourcesContainer"></div>` in the Overview section above the nodes table.
- **JS (`frontend/src/static/script.js`)**:
  - `_clusterData` extended with `nodeResources: null`.
  - `enterClusterDashboard()` and `refreshCurrentSection()` now call the new endpoint.
  - Added helpers: `handleNodeResourcesData()`, `renderNodeResourceCards()`, `_barClass()`, `_formatCpuAllocatable()`, `_formatMemory()`.
  - Each card shows node name, role badge, a CPU bar + allocatable value, a memory bar + allocatable value, and pod capacity. Bar colour: green < 70 %, amber < 90 %, red ≥ 90 %.
- **CSS (`frontend/src/static/style.css`)**:
  - Added `.node-resources-grid`, `.node-resource-card`, `.nrc-*` family of classes.
  - Bar fill states: `.bar-ok` (green), `.bar-warn` (amber), `.bar-critical` (red).

2026-03-07 — Assistant — Added a persistent "Home" button available from both cluster flows.
- **HTML**: Added `<button id="btnHomeFixed" class="home-fixed-btn" style="display:none;">⌂ Home</button>` as a fixed-position overlay before `#toast`.
- **JS**: Added `_goHome()` (hides both containers, resets `_clusterData`, hides button). `initWelcomeScreen()` now shows the button when entering any flow and wires a click handler on `btnHomeFixed`. A running-process guard shows a confirmation toast before navigating away if `_eventSource` is active.
- **CSS**: Added `.home-fixed-btn` — fixed top-left, purple gradient matching `.primary` button style (`linear-gradient(180deg, #4f46e5, #6366f1)`), same hover/active transitions.

2026-03-07 — Assistant — Modularised JS and CSS into component files; `script.js` and `style.css` are no longer loaded.

### Current frontend file layout

```
frontend/src/
├── main.py                     Flask backend (all endpoints)
├── templates/
│   └── index.html              Single-page app shell
└── static/
    ├── script.js               LEGACY — kept on disk, no longer loaded
    ├── style.css               LEGACY — kept on disk, no longer loaded
    ├── lightpillar.js          WebGL background effect (unchanged)
    ├── icons/                  SVG icons for tab nav
    ├── js/                     JS modules (loaded via <script> tags in order)
    │   ├── state.js            All shared `let` globals
    │   ├── utils.js            escapeHtml, showToast, showConfirmToast
    │   ├── navigation.js       Tab bubble, switchTab, updateTabStates
    │   ├── inventory.js        VM management, renderVMList, detectInventory
    │   ├── topology.js         renderTopology, showTopoInfo, openTopoEditor
    │   ├── connections.js      testConnections, testSingleConnection
    │   ├── deploy.js           Step cards, startDeploy, abortDeploy, startUninstall
    │   ├── cluster.js          Welcome screen wiring, cluster dashboard, node resource cards
    │   ├── handlers.js         setupHandlers() — all button event wiring
    │   └── main.js             DOMContentLoaded init block
    └── css/                    CSS modules (loaded via <link> tags)
        ├── base.css            :root vars, body, container, header, light-pillar, @keyframes popIn
        ├── buttons.css         .primary, .secondary, .toast, .retry-btn
        ├── navigation.css      .tab-navigation, .bubble-indicator, tab li/a, .actions
        ├── inventory.css       inputs, role switch, vm-list/entry, primordial selector
        ├── topology.css        .topology, .topo-*, SVG foreignObject editor, floating editor
        ├── connections.css     .connection-*, .ssh-config-section, @keyframes pulse
        ├── deploy.css          .step-card states, deploy/abort/uninstall buttons, @keyframes shimmer
        ├── welcome.css         .welcome-screen, .welcome-content, .welcome-buttons, .welcome-btn
        └── cluster.css         .nodes-table*, .cluster-nav*, .cluster-table-*, .nrc-*, .home-fixed-btn
```

### `index.html` script/style load order

```html
<!-- CSS -->
<link rel="stylesheet" href="static/css/base.css" />
<link rel="stylesheet" href="static/css/buttons.css" />
<link rel="stylesheet" href="static/css/navigation.css" />
<link rel="stylesheet" href="static/css/inventory.css" />
<link rel="stylesheet" href="static/css/topology.css" />
<link rel="stylesheet" href="static/css/connections.css" />
<link rel="stylesheet" href="static/css/deploy.css" />
<link rel="stylesheet" href="static/css/welcome.css" />
<link rel="stylesheet" href="static/css/cluster.css" />

<!-- JS (global scope, dependency order) -->
<script src="static/js/state.js"></script>
<script src="static/js/utils.js"></script>
<script src="static/js/navigation.js"></script>
<script src="static/js/inventory.js"></script>
<script src="static/js/topology.js"></script>
<script src="static/js/connections.js"></script>
<script src="static/js/deploy.js"></script>
<script src="static/js/cluster.js"></script>
<script src="static/js/handlers.js"></script>
<script src="static/js/main.js"></script>
<!-- three.js + lightpillar.js loaded after -->
```

### Flask endpoints summary (current)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/` | Serves `index.html` |
| POST | `/generate` | Generates Ansible inventory files from VM list JSON |
| POST | `/detect-inventory` | Scans `ansible/inv/` to detect an existing inventory |
| POST | `/test-ssh` | Tests SSH connectivity to a single host via paramiko |
| GET | `/deploy` | SSE stream — runs `k3s-install.yaml` playbook |
| GET | `/uninstall` | SSE stream — runs `k3s-uninstall.yaml` playbook |
| POST | `/deploy-abort` | Sends SIGTERM to the running ansible process group |
| GET | `/deploy-status` | Returns current process state (idle/running/success/failed/aborted) |
| POST | `/kubectl-nodes` | Runs `kubectl get nodes` with provided kubeconfig; returns table data |
| POST | `/kubectl-pods` | Runs `kubectl get pods -A` with provided kubeconfig; returns table data |
| POST | `/kubectl-services` | Runs `kubectl get services -A` with provided kubeconfig; returns table data |
| POST | `/kubectl-node-resources` | Runs `kubectl get nodes -o json` + optional `kubectl top nodes`; returns per-node CPU/memory/pod metrics |