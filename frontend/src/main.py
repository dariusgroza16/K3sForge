from flask import Flask, render_template, request, jsonify, Response
import yaml
import os
import paramiko
import io
import socket
import subprocess
import signal
import json
import tempfile
from threading import Thread, Lock
import time
import queue

app = Flask(__name__)

# Get the absolute path to the workspace root (two levels up from this file)
WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ANSIBLE_DIR = os.path.join(WORKSPACE_ROOT, 'ansible')
inv_location = os.path.join(WORKSPACE_ROOT, 'ansible', 'inv')
HOST_VARS_DIR = os.path.join(inv_location, 'host_vars')
os.makedirs(HOST_VARS_DIR, exist_ok=True)

# ── Global deploy / uninstall process state ──────────────────────────────
_proc_lock = Lock()
_current_proc = None          # subprocess.Popen | None
_deploy_status = 'idle'       # idle | running | success | failed | aborted

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
            vm_data = {
                'server_name': name,
                'server_ip': ip,
                'var_master': True
            }
            if primordial_master == name:
                vm_data['var_primordial_master'] = True
        else:
            all_data['all']['children']['workers']['hosts'][name] = None
            vm_data = {
                'server_name': name,
                'server_ip': ip,
                'var_worker': True
            }

        with open(os.path.join(HOST_VARS_DIR, f"{name}.yaml"), 'w') as f:
            yaml.dump(vm_data, f)

    # Save the all.yaml inventory file inside the chosen inventory folder
    with open(os.path.join(inv_location, 'all.yaml'), 'w') as f:
        yaml.dump(all_data, f)

    return jsonify({'status': 'success', 'primordial_master': primordial_master})

@app.route('/detect-inventory', methods=['GET'])
def detect_inventory():
    all_yaml_path = os.path.join(inv_location, 'all.yaml')
    
    # Check if all.yaml exists
    if not os.path.exists(all_yaml_path):
        return jsonify({'status': 'error', 'message': 'No inventory found.'}), 404
    
    try:
        # Load all.yaml
        with open(all_yaml_path, 'r') as f:
            all_data = yaml.safe_load(f)
        
        if not all_data or 'all' not in all_data:
            return jsonify({'status': 'error', 'message': 'Invalid inventory format.'}), 400
        
        vms = []
        primordial_master = None
        
        # Extract masters
        masters_hosts = all_data.get('all', {}).get('children', {}).get('masters', {}).get('hosts', {})
        for master_name in masters_hosts.keys():
            host_var_file = os.path.join(HOST_VARS_DIR, f"{master_name}.yaml")
            if os.path.exists(host_var_file):
                with open(host_var_file, 'r') as f:
                    host_data = yaml.safe_load(f)
                    vm = {
                        'name': master_name,
                        'ip': host_data.get('server_ip', ''),
                        'role': 'master'
                    }
                    if host_data.get('var_primordial_master'):
                        primordial_master = master_name
                    vms.append(vm)
        
        # Extract workers
        workers_hosts = all_data.get('all', {}).get('children', {}).get('workers', {}).get('hosts', {})
        for worker_name in workers_hosts.keys():
            host_var_file = os.path.join(HOST_VARS_DIR, f"{worker_name}.yaml")
            if os.path.exists(host_var_file):
                with open(host_var_file, 'r') as f:
                    host_data = yaml.safe_load(f)
                    vm = {
                        'name': worker_name,
                        'ip': host_data.get('server_ip', ''),
                        'role': 'worker'
                    }
                    vms.append(vm)
        
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
    
    host_var_file = os.path.join(HOST_VARS_DIR, f"{name}.yaml")
    
    try:
        if os.path.exists(host_var_file):
            os.remove(host_var_file)
            return jsonify({'status': 'success', 'message': f'Host {name} deleted.'})
        else:
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
INSTALL_STEPS = [
    {'id': 'docker',     'match': 'docker-install',              'label': 'Installing Docker'},
    {'id': 'primordial', 'match': 'master-primordial-install',   'label': 'Primordial Master'},
    {'id': 'kubeconfig', 'match': 'retrive-kubeconfig',          'label': 'Retrieve Kubeconfig'},
    {'id': 'masters',    'match': 'master-install',              'label': 'Join Masters'},
    {'id': 'workers',    'match': 'worker-install',              'label': 'Join Workers'},
]

UNINSTALL_STEPS = [
    {'id': 'pre_tasks',  'match': 'Ensure ~/.kube',              'label': 'Clean Kubeconfig'},
    {'id': 'masters',    'match': 'master-uninstall',            'label': 'Uninstall Masters'},
    {'id': 'workers',    'match': 'worker-uninstall',            'label': 'Uninstall Workers'},
    {'id': 'docker',     'match': 'docker-kill',                 'label': 'Stop Docker Containers'},
]


def _write_temp_key(ssh_key_text: str) -> str:
    """Write SSH key to a temp file and return its path."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='_k3sforge_key', mode='w')
    tmp.write(ssh_key_text.strip() + '\n')
    tmp.close()
    os.chmod(tmp.name, 0o600)
    return tmp.name


def _detect_step(line: str, steps: list) -> str | None:
    """Return the step id if *line* matches any step's match string."""
    for step in steps:
        if step['match'] in line:
            return step['id']
    return None


def _stream_playbook(playbook: str, username: str, key_path: str, steps: list):
    """Generator: runs ansible-playbook and yields SSE events."""
    global _current_proc, _deploy_status

    cmd = [
        'ansible-playbook',
        '-i', 'inv',
        f'playbooks/{playbook}',
        '--user', username,
        '--private-key', key_path,
        '-v',                       # a little verbosity for task names
    ]

    env = os.environ.copy()
    env['ANSIBLE_FORCE_COLOR'] = '0'
    env['ANSIBLE_NOCOLOR'] = '1'
    env['ANSIBLE_HOST_KEY_CHECKING'] = 'False'
    env['PYTHONUNBUFFERED'] = '1'

    active_step = None

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=ANSIBLE_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
            preexec_fn=os.setsid,     # own process group for clean kill
        )

        with _proc_lock:
            _current_proc = proc
            _deploy_status = 'running'

        # Send the list of steps so frontend knows what to render
        yield f"data: {json.dumps({'type': 'steps', 'steps': steps})}\n\n"

        for raw_line in iter(proc.stdout.readline, ''):
            line = raw_line.rstrip('\n')

            # Check if we entered a new step
            detected = _detect_step(line, steps)
            if detected and detected != active_step:
                # Mark previous step done
                if active_step:
                    yield f"data: {json.dumps({'type': 'step_done', 'step': active_step})}\n\n"
                active_step = detected
                yield f"data: {json.dumps({'type': 'step_start', 'step': active_step})}\n\n"

            # Check for TASK lines to provide sub-status
            if line.startswith('TASK ['):
                task_name = line.split('TASK [')[1].rstrip(' ]*').rstrip(']')
                yield f"data: {json.dumps({'type': 'task', 'step': active_step, 'task': task_name})}\n\n"

            # Detect failures in individual lines
            if 'fatal:' in line.lower() or 'failed:' in line.lower():
                yield f"data: {json.dumps({'type': 'task_warning', 'step': active_step, 'msg': line})}\n\n"

        proc.wait()

        with _proc_lock:
            _current_proc = None

        if proc.returncode == 0:
            if active_step:
                yield f"data: {json.dumps({'type': 'step_done', 'step': active_step})}\n\n"
            _deploy_status = 'success'
            yield f"data: {json.dumps({'type': 'finished', 'success': True})}\n\n"
        elif _deploy_status == 'aborted':
            yield f"data: {json.dumps({'type': 'finished', 'success': False, 'aborted': True})}\n\n"
        else:
            _deploy_status = 'failed'
            if active_step:
                yield f"data: {json.dumps({'type': 'step_failed', 'step': active_step})}\n\n"
            yield f"data: {json.dumps({'type': 'finished', 'success': False})}\n\n"

    except Exception as e:
        _deploy_status = 'failed'
        yield f"data: {json.dumps({'type': 'error', 'msg': str(e)})}\n\n"
    finally:
        # Clean up temp key
        try:
            os.unlink(key_path)
        except OSError:
            pass
        with _proc_lock:
            _current_proc = None


# ── Deploy endpoint (SSE stream) ────────────────────────────────────────

@app.route('/deploy', methods=['GET'])
def deploy():
    global _deploy_status
    username = request.args.get('username', '').strip()
    ssh_key = request.args.get('ssh_key', '').strip()

    if not username or not ssh_key:
        return jsonify({'status': 'error', 'message': 'Missing SSH credentials.'}), 400

    with _proc_lock:
        if _current_proc is not None:
            return jsonify({'status': 'error', 'message': 'A deploy/uninstall process is already running.'}), 409

    key_path = _write_temp_key(ssh_key)

    def gen():
        yield from _stream_playbook('k3s-install.yaml', username, key_path, INSTALL_STEPS)

    return Response(gen(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


# ── Deploy abort ─────────────────────────────────────────────────────────

@app.route('/deploy-abort', methods=['POST'])
def deploy_abort():
    global _deploy_status
    with _proc_lock:
        if _current_proc is None:
            return jsonify({'status': 'error', 'message': 'Nothing running.'}), 400
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
    ssh_key = request.args.get('ssh_key', '').strip()

    if not username or not ssh_key:
        return jsonify({'status': 'error', 'message': 'Missing SSH credentials.'}), 400

    with _proc_lock:
        if _current_proc is not None:
            return jsonify({'status': 'error', 'message': 'A process is already running.'}), 409

    key_path = _write_temp_key(ssh_key)

    def gen():
        yield from _stream_playbook('k3s-uninstall.yaml', username, key_path, UNINSTALL_STEPS)

    return Response(gen(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


# ── Deploy status (quick poll, no SSE) ──────────────────────────────────

@app.route('/deploy-status', methods=['GET'])
def deploy_status():
    return jsonify({'status': _deploy_status})


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
