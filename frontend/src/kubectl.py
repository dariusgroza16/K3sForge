import json
import os
import subprocess
import tempfile

from flask import Blueprint, jsonify, request

kubectl_bp = Blueprint('kubectl', __name__)


# ── Helper ────────────────────────────────────────────────────────────────

def _kubectl_get(kubeconfig: str, args: list, timeout: int = 30):
    """Write kubeconfig to a temp file, run kubectl with *args*, parse output.

    Returns a (dict, http_status) tuple suitable for jsonify.
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
        lines  = [ln for ln in output.splitlines() if ln.strip()]

        if not lines:
            return {'status': 'success', 'headers': [], 'rows': [], 'raw': output}, 200

        headers = lines[0].split()
        rows    = []
        for line in lines[1:]:
            parts = line.split(None, len(headers) - 1)
            while len(parts) < len(headers):
                parts.append('<none>')
            rows.append(parts)

        return {'status': 'success', 'headers': headers, 'rows': rows, 'raw': output}, 200

    except subprocess.TimeoutExpired:
        return {'status': 'error', 'message': f'kubectl timed out after {timeout} seconds.'}, 408
    except FileNotFoundError:
        return {'status': 'error',
                'message': 'kubectl not found. Please ensure kubectl is installed and on PATH.'}, 400
    except Exception as exc:
        return {'status': 'error', 'message': f'Unexpected error: {str(exc)}'}, 500
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ── Routes ────────────────────────────────────────────────────────────────

@kubectl_bp.route('/kubectl-nodes', methods=['POST'])
def kubectl_nodes():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400
    kubeconfig = data.get('kubeconfig', '').strip()
    if not kubeconfig:
        return jsonify({'status': 'error', 'message': 'Kubeconfig content is required.'}), 400

    body, code = _kubectl_get(kubeconfig, ['get', 'nodes', '-o', 'wide'])
    return jsonify(body), code


@kubectl_bp.route('/kubectl-pods', methods=['POST'])
def kubectl_pods():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400
    kubeconfig = data.get('kubeconfig', '').strip()
    if not kubeconfig:
        return jsonify({'status': 'error', 'message': 'Kubeconfig content is required.'}), 400

    body, code = _kubectl_get(kubeconfig, ['get', 'pods', '--all-namespaces', '-o', 'wide'])
    return jsonify(body), code


@kubectl_bp.route('/kubectl-services', methods=['POST'])
def kubectl_services():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({'status': 'error', 'message': 'Invalid or missing JSON body.'}), 400
    kubeconfig = data.get('kubeconfig', '').strip()
    if not kubeconfig:
        return jsonify({'status': 'error', 'message': 'Kubeconfig content is required.'}), 400

    body, code = _kubectl_get(kubeconfig, ['get', 'services', '--all-namespaces'])
    return jsonify(body), code


@kubectl_bp.route('/kubectl-node-resources', methods=['POST'])
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

        # ── Capacity / allocatable per node ───────────────────────────────
        nodes_result = subprocess.run(
            ['kubectl', '--kubeconfig', tmp_path, 'get', 'nodes', '-o', 'json'],
            capture_output=True, text=True, timeout=30,
        )
        if nodes_result.returncode != 0:
            err = nodes_result.stderr.strip() or nodes_result.stdout.strip() or 'kubectl get nodes failed'
            return jsonify({'status': 'error', 'message': err}), 400

        nodes_json = json.loads(nodes_result.stdout)

        # ── Live metrics (requires metrics-server — optional) ─────────────
        metrics: dict           = {}
        metrics_available: bool = False
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
                        'cpu_used':        parts[1],
                        'cpu_percent':     parts[2].rstrip('%'),
                        'memory_used':     parts[3],
                        'memory_percent':  parts[4].rstrip('%'),
                    }

        nodes = []
        for item in nodes_json.get('items', []):
            name   = item['metadata']['name']
            labels = item['metadata'].get('labels', {})
            role   = (
                'control-plane'
                if ('node-role.kubernetes.io/master' in labels
                    or 'node-role.kubernetes.io/control-plane' in labels)
                else 'worker'
            )
            capacity    = item['status'].get('capacity',    {})
            allocatable = item['status'].get('allocatable', {})

            node_data = {
                'name':               name,
                'role':               role,
                'cpu_allocatable':    allocatable.get('cpu',    capacity.get('cpu',    '0')),
                'memory_allocatable': allocatable.get('memory', capacity.get('memory', '0Ki')),
                'pods_allocatable':   int(allocatable.get('pods', capacity.get('pods', '110'))),
                'metrics_available':  metrics_available,
                'cpu_used':           None,
                'cpu_percent':        None,
                'memory_used':        None,
                'memory_percent':     None,
            }
            if metrics_available and name in metrics:
                node_data.update(metrics[name])

            nodes.append(node_data)

        return jsonify({'status': 'success', 'nodes': nodes,
                        'metrics_available': metrics_available})

    except subprocess.TimeoutExpired:
        return jsonify({'status': 'error', 'message': 'kubectl timed out.'}), 408
    except (json.JSONDecodeError, ValueError) as exc:
        return jsonify({'status': 'error',
                        'message': f'Failed to parse node data: {str(exc)}'}), 400
    except FileNotFoundError:
        return jsonify({'status': 'error',
                        'message': 'kubectl not found. Please ensure kubectl is installed and on PATH.'}), 400
    except Exception as exc:
        return jsonify({'status': 'error', 'message': f'Unexpected error: {str(exc)}'}), 500
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
