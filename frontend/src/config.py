import os
from threading import Lock, Event

# ── Path constants ────────────────────────────────────────────────────────
_SRC_DIR          = os.path.dirname(__file__)
WORKSPACE_ROOT    = os.path.abspath(os.path.join(_SRC_DIR, '..', '..'))
ANSIBLE_DIR       = os.path.join(WORKSPACE_ROOT, 'ansible')
inv_location      = os.path.join(WORKSPACE_ROOT, 'ansible', 'inv')
HOST_VARS_DIR     = os.path.join(inv_location, 'host_vars')
K3S_TEMPLATES_DIR = os.path.join(_SRC_DIR, 'k3s_templates')
K3S_INVENTORY_DIR = os.path.join(WORKSPACE_ROOT, 'inventory')

os.makedirs(HOST_VARS_DIR,     exist_ok=True)
os.makedirs(K3S_INVENTORY_DIR, exist_ok=True)

# ── Shared deploy / uninstall state ──────────────────────────────────────
proc_lock  = Lock()
abort_flag = Event()


class _DeployState:
    """Mutable container for deploy/uninstall runtime state.

    Using an object instead of module-level globals lets every module
    mutate the same instance after a simple `from config import deploy_state`.
    """
    status       = 'idle'   # idle | running | success | failed | aborted
    current_proc = None     # subprocess.Popen | None  (kept for abort compat)


deploy_state = _DeployState()
