from flask import Flask, render_template, request, jsonify
import yaml
import os

app = Flask(__name__)

inv_location = '~/repos/ClusterWatch/ansible/inv'  # Change this variable to set the inventory location
HOST_VARS_DIR = os.path.join(inv_location, 'host_vars')
os.makedirs(HOST_VARS_DIR, exist_ok=True)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/generate', methods=['POST'])
def generate():
    vms = request.json.get('vms', [])
    
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

    return jsonify({'status': 'success'})

if __name__ == '__main__':
    app.run(debug=True)
