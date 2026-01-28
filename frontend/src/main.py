from flask import Flask, render_template, request, jsonify
import yaml
import os
import paramiko
import io
import socket
from threading import Thread
import time

app = Flask(__name__)

# Get the absolute path to the workspace root (two levels up from this file)
WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
inv_location = os.path.join(WORKSPACE_ROOT, 'ansible', 'inv')
HOST_VARS_DIR = os.path.join(inv_location, 'host_vars')
os.makedirs(HOST_VARS_DIR, exist_ok=True)

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

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
