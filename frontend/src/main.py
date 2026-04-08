from flask import Flask, render_template, request, jsonify, Response
import yaml
import os
import re
import paramiko
import io
import socket
import subprocess
import signal
import json
import tempfile
from threading import Thread, Lock, Event
import time
import queue
from jinja2 import Environment, FileSystemLoader

app = Flask(__name__)

# Get the absolute path to the workspace root (two levels up from this file)
WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ANSIBLE_DIR = os.path.join(WORKSPACE_ROOT, 'ansible')
inv_location = os.path.join(WORKSPACE_ROOT, 'ansible', 'inv')
HOST_VARS_DIR = os.path.join(inv_location, 'host_vars')
os.makedirs(HOST_VARS_DIR, exist_ok=True)

K3S_TEMPLATES_DIR  = os.path.join(os.path.dirname(__file__), 'k3s_templates')
K3S_INVENTORY_DIR  = os.path.join(WORKSPACE_ROOT, 'inventory')
os.makedirs(K3S_INVENTORY_DIR, exist_ok=True)
_jinja_env: 'Environment | None' = None

# ── Global deploy / uninstall process state ──────────────────────────────
_proc_lock = Lock()
_current_proc = None          # subprocess.Popen | None  (used by uninstall)
_deploy_status = 'idle'       # idle | running | success | failed | aborted
_k3s_abort_flag = Event()     # set when the SSH-based install should abort

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/generate', methods=['POST'])
def generate():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400

    vms = data.get('vms', [])
    primordial_master = data.get('primordialMaster', None)

    if not isinstance(vms, list):
        return jsonify({'status': 'error', 'message': 'Invalid payload: vms must be a list.'}), 400

    # Basic validation: each vm must have name, ip, and role
    for idx, vm in enumerate(vms):
        if not isinstance(vm, dict):
            return jsonify({'status': 'error', 'message': f'Invalid VM entry at index {idx}.'}), 400
        if 'name' not in vm or 'ip' not in vm or 'role' not in vm:
            return jsonify({'status': 'error', 'message': f'VM at index {idx} is missing name/ip/role.'}), 400

    masters = [vm for vm in vms if vm.get('role') == 'master']
    if len(masters) == 0:
        return jsonify({'status': 'error', 'message': 'At least one master node is required.'}), 400

    master_names = [m['name'] for m in masters]
    # Auto-assign primordial_master if not provided or invalid
    if not primordial_master or primordial_master not in master_names:
        primordial_master = master_names[0]

    all_data = {'all': {'children': {'masters': {'hosts': {}}, 'workers': {'hosts': {}}}}}

    for vm in vms:
        name = vm['name']
        ip = vm['ip']
        role = vm['role']

        if role == 'master':
            all_data['all']['children']['masters']['hosts'][name] = None
            inv_data = {'name': name, 'ip': ip, 'role': 'master'}
            if primordial_master == name:
                inv_data['primordial'] = True
            ansible_data = {'server_name': name, 'server_ip': ip, 'var_master': True}
            if primordial_master == name:
                ansible_data['var_primordial_master'] = True
        else:
            all_data['all']['children']['workers']['hosts'][name] = None
            inv_data    = {'name': name, 'ip': ip, 'role': 'worker'}
            ansible_data = {'server_name': name, 'server_ip': ip, 'var_worker': True}

        # Write clean schema to K3sForge inventory directory
        with open(os.path.join(K3S_INVENTORY_DIR, f"{name}.yaml"), 'w') as f:
            yaml.dump(inv_data, f)

        # Write Ansible-compat schema to host_vars (unused fallback)
        with open(os.path.join(HOST_VARS_DIR, f"{name}.yaml"), 'w') as f:
            yaml.dump(ansible_data, f)

    # Save all.yaml for Ansible fallback
    with open(os.path.join(inv_location, 'all.yaml'), 'w') as f:
        yaml.dump(all_data, f)

    return jsonify({'status': 'success', 'primordial_master': primordial_master})

@app.route('/detect-inventory', methods=['GET'])
def detect_inventory():
    try:
        node_files = sorted(
            f for f in os.listdir(K3S_INVENTORY_DIR)
            if f.endswith('.yaml') or f.endswith('.yml')
        )
        if not node_files:
            return jsonify({'status': 'error', 'message': 'No inventory found.'}), 404

        vms = []
        primordial_master = None

        for fname in node_files:
            fpath = os.path.join(K3S_INVENTORY_DIR, fname)
            with open(fpath, 'r') as f:
                data = yaml.safe_load(f)
            if not isinstance(data, dict):
                continue

            name = data.get('name') or os.path.splitext(fname)[0]
            ip   = data.get('ip', '')
            role = data.get('role', 'worker')

            if role == 'master' and data.get('primordial'):
                primordial_master = name

            vms.append({'name': name, 'ip': ip, 'role': role})

        return jsonify({'status': 'success', 'vms': vms, 'primordial_master': primordial_master})

    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Failed to load inventory: {str(e)}'}), 500

@app.route('/delete-host', methods=['POST'])
def delete_host():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400
    
    name = data.get('name')
    if not name:
        return jsonify({'status': 'error', 'message': 'Missing host name.'}), 400
    
    inv_file      = os.path.join(K3S_INVENTORY_DIR, f"{name}.yaml")
    host_var_file = os.path.join(HOST_VARS_DIR, f"{name}.yaml")

    try:
        deleted = False
        for path in (inv_file, host_var_file):
            if os.path.exists(path):
                os.remove(path)
                deleted = True
        if deleted:
            return jsonify({'status': 'success', 'message': f'Host {name} deleted.'})
        return jsonify({'status': 'success', 'message': f'Host {name} not found in inventory.'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Failed to delete host: {str(e)}'}), 500

@app.route('/test-ssh', methods=['POST'])
def test_ssh():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400

    name = data.get('name')
    ip = data.get('ip')
    username = data.get('username')
    ssh_key = data.get('ssh_key')

    if not all([name, ip, username, ssh_key]):
        return jsonify({'status': 'error', 'message': 'Missing required fields.'}), 400

    # Test SSH connection
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        # Parse the private key
        key_file = io.StringIO(ssh_key)
        try:
            pkey = paramiko.RSAKey.from_private_key(key_file)
        except paramiko.ssh_exception.SSHException:
            # Try Ed25519
            key_file.seek(0)
            try:
                pkey = paramiko.Ed25519Key.from_private_key(key_file)
            except paramiko.ssh_exception.SSHException:
                # Try other key types
                key_file.seek(0)
                try:
                    pkey = paramiko.ECDSAKey.from_private_key(key_file)
                except paramiko.ssh_exception.SSHException:
                    key_file.seek(0)
                    try:
                        pkey = paramiko.DSSKey.from_private_key(key_file)
                    except paramiko.ssh_exception.SSHException:
                        return jsonify({'status': 'error', 'message': 'Invalid SSH key format.'}), 400

        # Attempt connection with timeout
        client.connect(
            hostname=ip,
            username=username,
            pkey=pkey,
            timeout=10,
            banner_timeout=10,
            auth_timeout=10
        )
        
        # Test command execution
        stdin, stdout, stderr = client.exec_command('echo "SSH test successful"', timeout=5)
        output = stdout.read().decode('utf-8').strip()
        
        client.close()
        
        if 'SSH test successful' in output:
            return jsonify({'status': 'success', 'message': f'Connected successfully to {name}'})
        else:
            return jsonify({'status': 'error', 'message': 'Connection established but command execution failed.'}), 400

    except paramiko.AuthenticationException:
        return jsonify({'status': 'error', 'message': 'Authentication failed. Check username and SSH key.'}), 400
    except paramiko.SSHException as e:
        return jsonify({'status': 'error', 'message': f'SSH error: {str(e)}'}), 400
    except socket.timeout:
        return jsonify({'status': 'error', 'message': 'Connection timeout. Check IP address and network.'}), 400
    except socket.error as e:
        return jsonify({'status': 'error', 'message': f'Network error: {str(e)}'}), 400
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Unexpected error: {str(e)}'}), 400
    finally:
        try:
            client.close()
        except:
            pass

# ── Helpers for streaming ansible-playbook via SSE ───────────────────────

# The install playbook roles fire in this order; we map ansible role task-name
# prefixes to human-readable step ids so the frontend can light up cards.



def _write_temp_key(ssh_key_text: str) -> str:
    """Write SSH key to a temp file and return its path."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='_k3sforge_key', mode='w')
    tmp.write(ssh_key_text.strip() + '\n')
    tmp.close()
    os.chmod(tmp.name, 0o600)
    return tmp.name


# ── Jinja2 / inventory helpers ────────────────────────────────────────────

def _get_jinja_env() -> Environment:
    global _jinja_env
    if _jinja_env is None:
        _jinja_env = Environment(loader=FileSystemLoader(K3S_TEMPLATES_DIR), autoescape=False)
    return _jinja_env


def _load_inventory() -> list:
    """Read every node YAML file from the K3sForge inventory dir."""
    nodes = []
    try:
        for fname in sorted(os.listdir(K3S_INVENTORY_DIR)):
            if fname.endswith('.yaml') or fname.endswith('.yml'):
                with open(os.path.join(K3S_INVENTORY_DIR, fname)) as f:
                    data = yaml.safe_load(f)
                    if isinstance(data, dict):
                        nodes.append(data)
    except Exception:
        pass
    return nodes


# ── Paramiko SSH helpers ──────────────────────────────────────────────────

def _open_ssh_client(ip: str, username: str, key_path: str, connect_timeout: int = 30) -> paramiko.SSHClient:
    """Create, connect, and return a Paramiko SSH client."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    pkey = None
    for key_cls in (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey, paramiko.DSSKey):
        try:
            pkey = key_cls.from_private_key_file(key_path)
            break
        except Exception:
            continue
    if pkey is None:
        raise ValueError('Unsupported or invalid private key format')
    client.connect(
        hostname=ip,
        username=username,
        pkey=pkey,
        timeout=connect_timeout,
        banner_timeout=connect_timeout,
        auth_timeout=connect_timeout,
    )
    return client


def _ssh_run_live(client: paramiko.SSHClient, cmd: str, timeout: int = 600):
    """
    Run *cmd* on the remote host and yield (line, None) for each output line,
    then yield (None, exit_code) at the end.  Non-blocking so the abort flag
    is checked on every iteration.
    """
    transport = client.get_transport()
    chan = transport.open_session()
    chan.set_combine_stderr(True)
    chan.setblocking(False)
    chan.exec_command(cmd)

    buf = ''
    deadline = time.monotonic() + timeout

    while not chan.exit_status_ready():
        if _k3s_abort_flag.is_set():
            chan.close()
            return
        if time.monotonic() > deadline:
            chan.close()
            return
        try:
            chunk = chan.recv(4096)
            if chunk:
                buf += chunk.decode('utf-8', errors='replace')
                while '\n' in buf:
                    line, buf = buf.split('\n', 1)
                    yield line, None
        except Exception:
            time.sleep(0.05)

    # Drain any remaining buffered output
    while True:
        try:
            chunk = chan.recv(4096)
            if not chunk:
                break
            buf += chunk.decode('utf-8', errors='replace')
        except Exception:
            break

    while '\n' in buf:
        line, buf = buf.split('\n', 1)
        yield line, None
    if buf.strip():
        yield buf, None

    yield None, chan.recv_exit_status()
    chan.close()


# ── K3s SSH install sub-generators ───────────────────────────────────────

def _gen_docker_on_node(ip: str, name: str, username: str, key_path: str):
    """Sub-generator: ensure Docker is installed on *ip*."""
    def _sse(d): return f"data: {json.dumps(d)}\n\n"
    client = None
    try:
        client = _open_ssh_client(ip, username, key_path)

        # Check if Docker is already installed
        rc = None
        for _, code in _ssh_run_live(client, 'docker --version 2>&1', timeout=10):
            if code is not None:
                rc = code

        if rc == 0:
            yield _sse({'type': 'log', 'step': 'docker', 'node': name,
                        'msg': f'[{name}] Docker already installed — skipping.'})
            return 0

        yield _sse({'type': 'task', 'step': 'docker', 'task': f'{name}: Installing Docker…'})

        rc = None
        for line, code in _ssh_run_live(
            client,
            'curl -fsSL https://get.docker.com | sudo sh 2>&1',
            timeout=300,
        ):
            if code is None:
                yield _sse({'type': 'log', 'step': 'docker', 'node': name, 'msg': line})
            else:
                rc = code

        if rc != 0:
            yield _sse({'type': 'task_warning', 'step': 'docker',
                        'msg': f'[{name}] Docker install script failed (rc={rc})'})
            return rc

        for _, _ in _ssh_run_live(client, 'sudo systemctl enable --now docker 2>&1', timeout=30):
            pass
        for _, _ in _ssh_run_live(client, f'sudo usermod -aG docker {username} 2>&1', timeout=10):
            pass

        yield _sse({'type': 'log', 'step': 'docker', 'node': name,
                    'msg': f'[{name}] Docker installed successfully.'})
        return 0

    except Exception as exc:
        yield _sse({'type': 'task_warning', 'step': 'docker',
                    'msg': f'[{name}] Docker error: {exc}'})
        return -1
    finally:
        if client:
            client.close()


def _gen_k3s_on_node(
    ip: str,
    name: str,
    username: str,
    key_path: str,
    config_content: str,
    install_args: str,
    step_id: str,
):
    """Sub-generator: upload config.yaml, run K3s installer, stream output."""
    def _sse(d): return f"data: {json.dumps(d)}\n\n"
    client = None
    try:
        client = _open_ssh_client(ip, username, key_path)

        # Create /etc/rancher/k3s/ and write config via sudo tee
        yield _sse({'type': 'task', 'step': step_id, 'task': f'{name}: Uploading K3s config…'})
        stdin, stdout, stderr = client.exec_command(
            'sudo mkdir -p /etc/rancher/k3s && sudo tee /etc/rancher/k3s/config.yaml',
            timeout=15,
        )
        stdin.write(config_content.encode('utf-8'))
        stdin.channel.shutdown_write()
        stdout.read()  # wait for tee to finish
        tee_rc = stdout.channel.recv_exit_status()
        if tee_rc != 0:
            yield _sse({'type': 'task_warning', 'step': step_id,
                        'msg': f'[{name}] Failed to write config.yaml (rc={tee_rc})'})
            return tee_rc

        # Run the K3s install script
        yield _sse({'type': 'task', 'step': step_id, 'task': f'{name}: Running K3s installer…'})
        install_cmd = f'curl -sfL https://get.k3s.io | sudo sh -s - {install_args} 2>&1'

        rc = None
        for line, code in _ssh_run_live(client, install_cmd, timeout=600):
            if code is None:
                yield _sse({'type': 'log', 'step': step_id, 'node': name, 'msg': line})
            else:
                rc = code

        if _k3s_abort_flag.is_set():
            return -1

        if rc != 0:
            yield _sse({'type': 'task_warning', 'step': step_id,
                        'msg': f'[{name}] K3s installer failed (rc={rc})'})
            return rc

        yield _sse({'type': 'log', 'step': step_id, 'node': name,
                    'msg': f'[{name}] K3s installed successfully.'})
        return 0

    except Exception as exc:
        yield _sse({'type': 'task_warning', 'step': step_id,
                    'msg': f'[{name}] Error: {exc}'})
        return -1
    finally:
        if client:
            client.close()


# ── Main K3s SSH install stream generator ────────────────────────────────

def _stream_k3s_install(username: str, key_path: str, token: str, use_docker: bool):
    """Generator: installs K3s across all nodes via SSH and yields SSE events."""
    global _deploy_status

    def _sse(d): return f"data: {json.dumps(d)}\n\n"

    try:
        # ── Load inventory ───────────────────────────────────────────────
        nodes = _load_inventory()
        if not nodes:
            _deploy_status = 'failed'
            yield _sse({'type': 'error', 'msg': 'No inventory found. Generate inventory first.'})
            return

        primordial = next((n for n in nodes if n.get('primordial')), None)
        if not primordial:
            _deploy_status = 'failed'
            yield _sse({'type': 'error', 'msg': 'No primordial master defined in inventory.'})
            return

        joining_masters = [n for n in nodes if n.get('role') == 'master' and not n.get('primordial')]
        workers         = [n for n in nodes if n.get('role') == 'worker']
        all_nodes       = [primordial] + joining_masters + workers
        primordial_ip   = primordial['ip']

        # ── Build step list ──────────────────────────────────────────────
        steps = []
        if use_docker:
            steps.append({'id': 'docker',     'label': 'Install Docker'})
        steps.append(    {'id': 'primordial', 'label': 'Primordial Master'})
        steps.append(    {'id': 'kubeconfig', 'label': 'Retrieve Kubeconfig'})
        if joining_masters:
            steps.append({'id': 'masters',    'label': 'Join Masters'})
        if workers:
            steps.append({'id': 'workers',    'label': 'Join Workers'})

        yield _sse({'type': 'steps', 'steps': steps})

        env          = _get_jinja_env()
        master_tmpl  = env.get_template('master.yaml.j2')
        worker_tmpl  = env.get_template('worker.yaml.j2')

        # ── Phase 1: Docker (optional) ───────────────────────────────────
        if use_docker:
            yield _sse({'type': 'step_start', 'step': 'docker'})
            step_ok = True
            for node in all_nodes:
                if _k3s_abort_flag.is_set():
                    break
                rc = yield from _gen_docker_on_node(
                    node['ip'], node['name'], username, key_path)
                if rc != 0:
                    step_ok = False

            if _k3s_abort_flag.is_set():
                _deploy_status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if step_ok:
                yield _sse({'type': 'step_done', 'step': 'docker'})
            else:
                yield _sse({'type': 'step_failed', 'step': 'docker'})
                _deploy_status = 'failed'
                yield _sse({'type': 'finished', 'success': False})
                return

        # ── Phase 2: Primordial Master ───────────────────────────────────
        yield _sse({'type': 'step_start', 'step': 'primordial'})

        config_yaml = master_tmpl.render(
            cluster_init=True,
            server_ip=primordial_ip,
            token=token,
            docker=use_docker,
            primordial_ip=primordial_ip,
        )

        rc = yield from _gen_k3s_on_node(
            primordial_ip, primordial['name'], username, key_path,
            config_yaml, 'server', 'primordial',
        )

        if _k3s_abort_flag.is_set():
            _deploy_status = 'aborted'
            yield _sse({'type': 'finished', 'success': False, 'aborted': True})
            return

        if rc != 0:
            yield _sse({'type': 'step_failed', 'step': 'primordial'})
            _deploy_status = 'failed'
            yield _sse({'type': 'finished', 'success': False})
            return

        # Wait for the K3s API server to become ready
        yield _sse({'type': 'task', 'step': 'primordial', 'task': 'Waiting for API server…'})
        api_ready   = False
        wait_client = _open_ssh_client(primordial_ip, username, key_path)
        try:
            for _ in range(24):  # up to ~2 minutes (24 × 5 s)
                if _k3s_abort_flag.is_set():
                    break
                wait_rc = None
                for _, code in _ssh_run_live(wait_client, 'sudo k3s kubectl get nodes 2>&1', timeout=15):
                    if code is not None:
                        wait_rc = code
                if wait_rc == 0:
                    api_ready = True
                    break
                time.sleep(5)
        finally:
            wait_client.close()

        if _k3s_abort_flag.is_set():
            _deploy_status = 'aborted'
            yield _sse({'type': 'finished', 'success': False, 'aborted': True})
            return

        if not api_ready:
            yield _sse({'type': 'step_failed', 'step': 'primordial'})
            _deploy_status = 'failed'
            yield _sse({'type': 'finished', 'success': False})
            return

        yield _sse({'type': 'step_done', 'step': 'primordial'})

        # ── Phase 3: Retrieve Kubeconfig ─────────────────────────────────
        yield _sse({'type': 'step_start', 'step': 'kubeconfig'})
        yield _sse({'type': 'task', 'step': 'kubeconfig', 'task': 'Fetching kubeconfig…'})

        kube_client = _open_ssh_client(primordial_ip, username, key_path)
        try:
            stdin, stdout, _ = kube_client.exec_command(
                'sudo cat /etc/rancher/k3s/k3s.yaml', timeout=15)
            raw_kube = stdout.read().decode('utf-8')
            if raw_kube:
                kubeconfig = re.sub(
                    r'https://127\.0\.0\.1(:\d+)?',
                    lambda m: f'https://{primordial_ip}{m.group(1) or ""}',
                    raw_kube,
                )
                kube_dir  = os.path.expanduser('~/.kube')
                os.makedirs(kube_dir, exist_ok=True)
                kube_path = os.path.join(kube_dir, 'k3s.yaml')
                with open(kube_path, 'w') as f:
                    f.write(kubeconfig)
                os.chmod(kube_path, 0o600)
                yield _sse({'type': 'log', 'step': 'kubeconfig', 'node': 'local',
                            'msg': f'Kubeconfig saved to {kube_path}'})
            else:
                yield _sse({'type': 'task_warning', 'step': 'kubeconfig',
                            'msg': 'k3s.yaml was empty — kubeconfig not saved.'})
        except Exception as exc:
            yield _sse({'type': 'task_warning', 'step': 'kubeconfig',
                        'msg': f'Could not retrieve kubeconfig: {exc}'})
        finally:
            kube_client.close()

        yield _sse({'type': 'step_done', 'step': 'kubeconfig'})

        # ── Phase 4: Join Masters ─────────────────────────────────────────
        if joining_masters:
            yield _sse({'type': 'step_start', 'step': 'masters'})
            step_ok = True
            for node in joining_masters:
                if _k3s_abort_flag.is_set():
                    break
                cfg = master_tmpl.render(
                    cluster_init=False,
                    server_ip=node['ip'],
                    token=token,
                    docker=use_docker,
                    primordial_ip=primordial_ip,
                )
                rc = yield from _gen_k3s_on_node(
                    node['ip'], node['name'], username, key_path,
                    cfg, 'server', 'masters',
                )
                if rc != 0:
                    step_ok = False

            if _k3s_abort_flag.is_set():
                _deploy_status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if step_ok:
                yield _sse({'type': 'step_done', 'step': 'masters'})
            else:
                yield _sse({'type': 'step_failed', 'step': 'masters'})
                _deploy_status = 'failed'
                yield _sse({'type': 'finished', 'success': False})
                return

        # ── Phase 5: Join Workers ─────────────────────────────────────────
        if workers:
            yield _sse({'type': 'step_start', 'step': 'workers'})
            step_ok = True
            for node in workers:
                if _k3s_abort_flag.is_set():
                    break
                cfg = worker_tmpl.render(
                    token=token,
                    docker=use_docker,
                    primordial_ip=primordial_ip,
                )
                rc = yield from _gen_k3s_on_node(
                    node['ip'], node['name'], username, key_path,
                    cfg, 'agent', 'workers',
                )
                if rc != 0:
                    step_ok = False

            if _k3s_abort_flag.is_set():
                _deploy_status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if step_ok:
                yield _sse({'type': 'step_done', 'step': 'workers'})
            else:
                yield _sse({'type': 'step_failed', 'step': 'workers'})
                _deploy_status = 'failed'
                yield _sse({'type': 'finished', 'success': False})
                return

        _deploy_status = 'success'
        yield _sse({'type': 'finished', 'success': True})

    except Exception as exc:
        _deploy_status = 'failed'
        yield _sse({'type': 'error', 'msg': str(exc)})
    finally:
        try:
            os.unlink(key_path)
        except OSError:
            pass


# ── K3s SSH uninstall sub-generator ─────────────────────────────────────

def _gen_uninstall_node(ip: str, name: str, username: str, key_path: str,
                        is_server: bool, step_id: str):
    """Sub-generator: run the K3s uninstall script on a single node."""
    def _sse(d): return f"data: {json.dumps(d)}\n\n"
    script = 'k3s-uninstall.sh' if is_server else 'k3s-agent-uninstall.sh'
    client = None
    try:
        client = _open_ssh_client(ip, username, key_path)
        yield _sse({'type': 'task', 'step': step_id, 'task': f'{name}: Running {script}…'})

        rc = None
        for line, code in _ssh_run_live(
            client, f'sudo /usr/local/bin/{script} 2>&1', timeout=120
        ):
            if code is None:
                yield _sse({'type': 'log', 'step': step_id, 'node': name, 'msg': line})
            else:
                rc = code

        if rc != 0:
            yield _sse({'type': 'task_warning', 'step': step_id,
                        'msg': f'[{name}] {script} exited with rc={rc}'})
        else:
            yield _sse({'type': 'log', 'step': step_id, 'node': name,
                        'msg': f'[{name}] Uninstalled successfully.'})
        return rc if rc is not None else -1

    except Exception as exc:
        yield _sse({'type': 'task_warning', 'step': step_id,
                    'msg': f'[{name}] Error: {exc}'})
        return -1
    finally:
        if client:
            client.close()


# ── Main K3s SSH uninstall stream generator ───────────────────────────────

def _stream_k3s_uninstall(username: str, key_path: str):
    """Generator: uninstalls K3s from all nodes via SSH and yields SSE events."""
    global _deploy_status

    def _sse(d): return f"data: {json.dumps(d)}\n\n"

    try:
        nodes = _load_inventory()
        if not nodes:
            _deploy_status = 'failed'
            yield _sse({'type': 'error', 'msg': 'No inventory found.'})
            return

        primordial      = next((n for n in nodes if n.get('primordial')), None)
        joining_masters = [n for n in nodes if n.get('role') == 'master' and not n.get('primordial')]
        workers         = [n for n in nodes if n.get('role') == 'worker']

        # Build steps in uninstall order: workers → joining masters → primordial → local cleanup
        steps = []
        if workers:
            steps.append({'id': 'workers',    'label': 'Uninstall Workers'})
        if joining_masters:
            steps.append({'id': 'masters',    'label': 'Uninstall Masters'})
        if primordial:
            steps.append({'id': 'primordial', 'label': 'Uninstall Primordial'})
        steps.append(    {'id': 'kubeconfig', 'label': 'Clean Kubeconfig'})

        yield _sse({'type': 'steps', 'steps': steps})

        # ── Phase 1: Workers ─────────────────────────────────────────────
        if workers:
            yield _sse({'type': 'step_start', 'step': 'workers'})
            step_ok = True
            for node in workers:
                if _k3s_abort_flag.is_set():
                    break
                rc = yield from _gen_uninstall_node(
                    node['ip'], node['name'], username, key_path, False, 'workers')
                if rc != 0:
                    step_ok = False

            if _k3s_abort_flag.is_set():
                _deploy_status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if step_ok:
                yield _sse({'type': 'step_done', 'step': 'workers'})
            else:
                yield _sse({'type': 'step_failed', 'step': 'workers'})
                _deploy_status = 'failed'
                yield _sse({'type': 'finished', 'success': False})
                return

        # ── Phase 2: Joining Masters ──────────────────────────────────────
        if joining_masters:
            yield _sse({'type': 'step_start', 'step': 'masters'})
            step_ok = True
            for node in joining_masters:
                if _k3s_abort_flag.is_set():
                    break
                rc = yield from _gen_uninstall_node(
                    node['ip'], node['name'], username, key_path, True, 'masters')
                if rc != 0:
                    step_ok = False

            if _k3s_abort_flag.is_set():
                _deploy_status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if step_ok:
                yield _sse({'type': 'step_done', 'step': 'masters'})
            else:
                yield _sse({'type': 'step_failed', 'step': 'masters'})
                _deploy_status = 'failed'
                yield _sse({'type': 'finished', 'success': False})
                return

        # ── Phase 3: Primordial Master ────────────────────────────────────
        if primordial:
            yield _sse({'type': 'step_start', 'step': 'primordial'})
            rc = yield from _gen_uninstall_node(
                primordial['ip'], primordial['name'], username, key_path, True, 'primordial')

            if _k3s_abort_flag.is_set():
                _deploy_status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if rc != 0:
                yield _sse({'type': 'step_failed', 'step': 'primordial'})
                _deploy_status = 'failed'
                yield _sse({'type': 'finished', 'success': False})
                return

            yield _sse({'type': 'step_done', 'step': 'primordial'})

        # ── Phase 4: Clean local kubeconfig ───────────────────────────────
        yield _sse({'type': 'step_start', 'step': 'kubeconfig'})
        kube_path = os.path.expanduser('~/.kube/k3s.yaml')
        try:
            if os.path.exists(kube_path):
                os.remove(kube_path)
                yield _sse({'type': 'log', 'step': 'kubeconfig', 'node': 'local',
                            'msg': f'Removed {kube_path}'})
            else:
                yield _sse({'type': 'log', 'step': 'kubeconfig', 'node': 'local',
                            'msg': 'No local kubeconfig to clean.'})
        except OSError as exc:
            yield _sse({'type': 'task_warning', 'step': 'kubeconfig',
                        'msg': f'Could not remove kubeconfig: {exc}'})
        yield _sse({'type': 'step_done', 'step': 'kubeconfig'})

        _deploy_status = 'success'
        yield _sse({'type': 'finished', 'success': True})

    except Exception as exc:
        _deploy_status = 'failed'
        yield _sse({'type': 'error', 'msg': str(exc)})
    finally:
        try:
            os.unlink(key_path)
        except OSError:
            pass


# ── Deploy endpoint (SSE stream) ────────────────────────────────────────

@app.route('/deploy', methods=['GET'])
def deploy():
    global _deploy_status
    username = request.args.get('username', '').strip()
    ssh_key  = request.args.get('ssh_key',  '').strip()
    token    = request.args.get('token',    '').strip()
    docker   = request.args.get('docker', 'false').lower() == 'true'

    if not username or not ssh_key:
        return jsonify({'status': 'error', 'message': 'Missing SSH credentials.'}), 400
    if not token:
        return jsonify({'status': 'error', 'message': 'Missing cluster token.'}), 400

    with _proc_lock:
        if _deploy_status == 'running':
            return jsonify({'status': 'error', 'message': 'A deploy/uninstall process is already running.'}), 409
        _deploy_status = 'running'

    _k3s_abort_flag.clear()
    key_path = _write_temp_key(ssh_key)

    def gen():
        yield from _stream_k3s_install(username, key_path, token, docker)

    return Response(gen(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


# ── Deploy abort ─────────────────────────────────────────────────────────

@app.route('/deploy-abort', methods=['POST'])
def deploy_abort():
    global _deploy_status
    # Signal the SSH-based install generator to stop
    _k3s_abort_flag.set()
    # Also kill any running Ansible subprocess (used by uninstall)
    with _proc_lock:
        if _current_proc is not None:
            _deploy_status = 'aborted'
            try:
                os.killpg(os.getpgid(_current_proc.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
    return jsonify({'status': 'success', 'message': 'Abort signal sent.'})


# ── Uninstall endpoint (SSE stream) ─────────────────────────────────────

@app.route('/uninstall', methods=['GET'])
def uninstall():
    global _deploy_status
    username = request.args.get('username', '').strip()
    ssh_key  = request.args.get('ssh_key',  '').strip()

    if not username or not ssh_key:
        return jsonify({'status': 'error', 'message': 'Missing SSH credentials.'}), 400

    with _proc_lock:
        if _deploy_status == 'running':
            return jsonify({'status': 'error', 'message': 'A process is already running.'}), 409
        _deploy_status = 'running'

    _k3s_abort_flag.clear()
    key_path = _write_temp_key(ssh_key)

    def gen():
        yield from _stream_k3s_uninstall(username, key_path)

    return Response(gen(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


# ── Deploy status (quick poll, no SSE) ──────────────────────────────────

@app.route('/deploy-status', methods=['GET'])
def deploy_status():
    return jsonify({'status': _deploy_status})


# ── Existing Cluster: kubectl get nodes -o wide ──────────────────────────

@app.route('/kubectl-nodes', methods=['POST'])
def kubectl_nodes():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400
    kubeconfig = data.get('kubeconfig', '').strip()
    if not kubeconfig:
        return jsonify({'status': 'error', 'message': 'Kubeconfig content is required.'}), 400

    body, code = _kubectl_get(kubeconfig, ['get', 'nodes', '-o', 'wide'])
    return jsonify(body), code


def _kubectl_get(kubeconfig: str, args: list, timeout: int = 30):
    """
    Helper: write kubeconfig to a temp file, run kubectl with *args*,
    parse tab-separated wide output and return (headers, rows) or raise.
    Returns a dict ready to jsonify.
    """
    tmp_path = None
    try:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix='_k3sforge_kube', mode='w')
        tmp.write(kubeconfig)
        tmp.close()
        tmp_path = tmp.name
        os.chmod(tmp_path, 0o600)

        result = subprocess.run(
            ['kubectl', '--kubeconfig', tmp_path] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

        if result.returncode != 0:
            error_msg = result.stderr.strip() or result.stdout.strip() or 'kubectl command failed'
            return {'status': 'error', 'message': error_msg}, 400

        output = result.stdout.strip()
        lines = [l for l in output.splitlines() if l.strip()]

        if not lines:
            return {'status': 'success', 'headers': [], 'rows': [], 'raw': output}, 200

        headers = lines[0].split()
        rows = []
        for line in lines[1:]:
            parts = line.split(None, len(headers) - 1)
            while len(parts) < len(headers):
                parts.append('<none>')
            rows.append(parts)

        return {'status': 'success', 'headers': headers, 'rows': rows, 'raw': output}, 200

    except subprocess.TimeoutExpired:
        return {'status': 'error', 'message': f'kubectl timed out after {timeout} seconds.'}, 408
    except FileNotFoundError:
        return {'status': 'error', 'message': 'kubectl not found. Please ensure kubectl is installed and on PATH.'}, 400
    except Exception as e:
        return {'status': 'error', 'message': f'Unexpected error: {str(e)}'}, 500
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


@app.route('/kubectl-pods', methods=['POST'])
def kubectl_pods():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400
    kubeconfig = data.get('kubeconfig', '').strip()
    if not kubeconfig:
        return jsonify({'status': 'error', 'message': 'Kubeconfig content is required.'}), 400

    body, code = _kubectl_get(kubeconfig, ['get', 'pods', '--all-namespaces', '-o', 'wide'])
    return jsonify(body), code


@app.route('/kubectl-services', methods=['POST'])
def kubectl_services():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400
    kubeconfig = data.get('kubeconfig', '').strip()
    if not kubeconfig:
        return jsonify({'status': 'error', 'message': 'Kubeconfig content is required.'}), 400

    body, code = _kubectl_get(kubeconfig, ['get', 'services', '--all-namespaces'])
    return jsonify(body), code


@app.route('/kubectl-node-resources', methods=['POST'])
def kubectl_node_resources():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400
    kubeconfig = data.get('kubeconfig', '').strip()
    if not kubeconfig:
        return jsonify({'status': 'error', 'message': 'Kubeconfig content is required.'}), 400

    tmp_path = None
    try:
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix='_k3sforge_kube', mode='w')
        tmp.write(kubeconfig)
        tmp.close()
        tmp_path = tmp.name
        os.chmod(tmp_path, 0o600)

        # Get allocatable / capacity data per node
        nodes_result = subprocess.run(
            ['kubectl', '--kubeconfig', tmp_path, 'get', 'nodes', '-o', 'json'],
            capture_output=True, text=True, timeout=30,
        )
        if nodes_result.returncode != 0:
            err = nodes_result.stderr.strip() or nodes_result.stdout.strip() or 'kubectl get nodes failed'
            return jsonify({'status': 'error', 'message': err}), 400

        nodes_json = json.loads(nodes_result.stdout)

        # Try to get live metrics (requires metrics-server — optional)
        metrics: dict = {}
        metrics_available = False
        top_result = subprocess.run(
            ['kubectl', '--kubeconfig', tmp_path, 'top', 'nodes', '--no-headers'],
            capture_output=True, text=True, timeout=15,
        )
        if top_result.returncode == 0:
            metrics_available = True
            for line in top_result.stdout.strip().splitlines():
                parts = line.split()
                # Columns: NAME CPU(cores) CPU% MEMORY(bytes) MEMORY%
                if len(parts) >= 5:
                    metrics[parts[0]] = {
                        'cpu_used': parts[1],
                        'cpu_percent': parts[2].rstrip('%'),
                        'memory_used': parts[3],
                        'memory_percent': parts[4].rstrip('%'),
                    }

        nodes = []
        for item in nodes_json.get('items', []):
            name = item['metadata']['name']
            labels = item['metadata'].get('labels', {})
            role = (
                'control-plane'
                if ('node-role.kubernetes.io/master' in labels
                    or 'node-role.kubernetes.io/control-plane' in labels)
                else 'worker'
            )
            capacity = item['status'].get('capacity', {})
            allocatable = item['status'].get('allocatable', {})

            node_data = {
                'name': name,
                'role': role,
                'cpu_allocatable': allocatable.get('cpu', capacity.get('cpu', '0')),
                'memory_allocatable': allocatable.get('memory', capacity.get('memory', '0Ki')),
                'pods_allocatable': int(allocatable.get('pods', capacity.get('pods', '110'))),
                'metrics_available': metrics_available,
                'cpu_used': None,
                'cpu_percent': None,
                'memory_used': None,
                'memory_percent': None,
            }
            if metrics_available and name in metrics:
                node_data.update(metrics[name])

            nodes.append(node_data)

        return jsonify({'status': 'success', 'nodes': nodes, 'metrics_available': metrics_available})

    except subprocess.TimeoutExpired:
        return jsonify({'status': 'error', 'message': 'kubectl timed out.'}), 408
    except (json.JSONDecodeError, ValueError) as e:
        return jsonify({'status': 'error', 'message': f'Failed to parse node data: {str(e)}'}), 400
    except FileNotFoundError:
        return jsonify({'status': 'error', 'message': 'kubectl not found. Please ensure kubectl is installed and on PATH.'}), 400
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Unexpected error: {str(e)}'}), 500
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
