from flask import Flask, render_template, request, jsonify
import yaml
import os

app = Flask(__name__)

inv_location = './ansible/inv'  # Change this variable to set the inventory location
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

if __name__ == '__main__':
    app.run(debug=True)
