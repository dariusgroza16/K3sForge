// ── Shared application state ──────────────────────────────────────────

// Inventory / new-cluster flow
let vms = [];
let primordialMaster = null;
let inventoryExists = false;
let deletedVMs = [];
let allConnectionsPass = false;
let clusterDeployed = false;
let _eventSource = null;
let _nodeStatuses = {};

// Cluster dashboard (existing cluster flow)
let _clusterData = { nodes: null, pods: null, services: null, nodeResources: null };
let _activeClusterSection = 'overview';

// Welcome-screen uninstall flow
let _uninstallNodes = [];
let _uninstallConnPass = false;
