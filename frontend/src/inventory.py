import io
import os
import socket

import paramiko
import yaml
from flask import Blueprint, jsonify, request

from config import K3S_INVENTORY_DIR

inventory_bp = Blueprint('inventory', __name__)


# ── Shared helper (imported by installer / uninstaller) ───────────────────

def _load_inventory() -> list:
    """Read every node YAML file from the K3sForge inventory directory."""
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


# ── Routes ────────────────────────────────────────────────────────────────

@inventory_bp.route('/generate', methods=['POST'])
def generate():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400

    vms               = data.get('vms', [])
    primordial_master = data.get('primordialMaster', None)

    if not isinstance(vms, list):
        return jsonify({'status': 'error', 'message': 'Invalid payload: vms must be a list.'}), 400

    for idx, vm in enumerate(vms):
        if not isinstance(vm, dict):
            return jsonify({'status': 'error', 'message': f'Invalid VM entry at index {idx}.'}), 400
        if 'name' not in vm or 'ip' not in vm or 'role' not in vm:
            return jsonify({'status': 'error',
                            'message': f'VM at index {idx} is missing name/ip/role.'}), 400

    masters = [vm for vm in vms if vm.get('role') == 'master']
    if not masters:
        return jsonify({'status': 'error', 'message': 'At least one master node is required.'}), 400

    master_names = [m['name'] for m in masters]
    if not primordial_master or primordial_master not in master_names:
        primordial_master = master_names[0]

    for vm in vms:
        name = vm['name']
        ip   = vm['ip']
        role = vm['role']

        if role == 'master':
            inv_data = {'name': name, 'ip': ip, 'role': 'master'}
            if primordial_master == name:
                inv_data['primordial'] = True
        else:
            inv_data = {'name': name, 'ip': ip, 'role': 'worker'}

        with open(os.path.join(K3S_INVENTORY_DIR, f'{name}.yaml'), 'w') as f:
            yaml.dump(inv_data, f)

    return jsonify({'status': 'success', 'primordial_master': primordial_master})


@inventory_bp.route('/detect-inventory', methods=['GET'])
def detect_inventory():
    try:
        node_files = sorted(
            f for f in os.listdir(K3S_INVENTORY_DIR)
            if f.endswith('.yaml') or f.endswith('.yml')
        )
        if not node_files:
            return jsonify({'status': 'error', 'message': 'No inventory found.'}), 404

        vms               = []
        primordial_master = None

        for fname in node_files:
            with open(os.path.join(K3S_INVENTORY_DIR, fname)) as f:
                node = yaml.safe_load(f)
            if not isinstance(node, dict):
                continue

            name = node.get('name') or os.path.splitext(fname)[0]
            ip   = node.get('ip', '')
            role = node.get('role', 'worker')

            if role == 'master' and node.get('primordial'):
                primordial_master = name

            vms.append({'name': name, 'ip': ip, 'role': role})

        return jsonify({'status': 'success', 'vms': vms, 'primordial_master': primordial_master})

    except Exception as exc:
        return jsonify({'status': 'error', 'message': f'Failed to load inventory: {exc}'}), 500


@inventory_bp.route('/delete-host', methods=['POST'])
def delete_host():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400

    name = data.get('name')
    if not name:
        return jsonify({'status': 'error', 'message': 'Missing host name.'}), 400

    inv_file = os.path.join(K3S_INVENTORY_DIR, f'{name}.yaml')

    try:
        if os.path.exists(inv_file):
            os.remove(inv_file)
            return jsonify({'status': 'success', 'message': f'Host {name} deleted.'})
        return jsonify({'status': 'success', 'message': f'Host {name} not found in inventory.'})
    except Exception as exc:
        return jsonify({'status': 'error', 'message': f'Failed to delete host: {exc}'}), 500


@inventory_bp.route('/test-ssh', methods=['POST'])
def test_ssh():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400

    name     = data.get('name')
    ip       = data.get('ip')
    username = data.get('username')
    ssh_key  = data.get('ssh_key')

    if not all([name, ip, username, ssh_key]):
        return jsonify({'status': 'error', 'message': 'Missing required fields.'}), 400

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        key_file = io.StringIO(ssh_key)
        pkey     = None
        for key_cls in (paramiko.RSAKey, paramiko.Ed25519Key,
                        paramiko.ECDSAKey, paramiko.DSSKey):
            try:
                key_file.seek(0)
                pkey = key_cls.from_private_key(key_file)
                break
            except paramiko.ssh_exception.SSHException:
                continue
        if pkey is None:
            return jsonify({'status': 'error', 'message': 'Invalid SSH key format.'}), 400

        client.connect(hostname=ip, username=username, pkey=pkey,
                       timeout=10, banner_timeout=10, auth_timeout=10)
        _, stdout, _ = client.exec_command('echo "SSH test successful"', timeout=5)
        output = stdout.read().decode('utf-8').strip()
        client.close()

        if 'SSH test successful' in output:
            return jsonify({'status': 'success',
                            'message': f'Connected successfully to {name}'})
        return jsonify({'status': 'error',
                        'message': 'Connection established but command execution failed.'}), 400

    except paramiko.AuthenticationException:
        return jsonify({'status': 'error',
                        'message': 'Authentication failed. Check username and SSH key.'}), 400
    except paramiko.SSHException as exc:
        return jsonify({'status': 'error', 'message': f'SSH error: {exc}'}), 400
    except socket.timeout:
        return jsonify({'status': 'error',
                        'message': 'Connection timeout. Check IP address and network.'}), 400
    except socket.error as exc:
        return jsonify({'status': 'error', 'message': f'Network error: {exc}'}), 400
    except Exception as exc:
        return jsonify({'status': 'error', 'message': f'Unexpected error: {exc}'}), 400
    finally:
        try:
            client.close()
        except Exception:
            pass
