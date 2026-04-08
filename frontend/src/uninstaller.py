import json
import os

from flask import Blueprint, Response, jsonify, request

from config import abort_flag, deploy_state, proc_lock
from inventory import _load_inventory
from ssh import _open_ssh_client, _ssh_run_live, _write_temp_key

uninstaller_bp = Blueprint('uninstaller', __name__)


# ── Sub-generator ─────────────────────────────────────────────────────────

def _gen_uninstall_node(ip: str, name: str, username: str, key_path: str,
                        is_server: bool, step_id: str):
    """Sub-generator: run the K3s uninstall script on a single node.

    Servers:  /usr/local/bin/k3s-uninstall.sh
    Agents:   /usr/local/bin/k3s-agent-uninstall.sh
    """
    def _sse(d): return f"data: {json.dumps(d)}\n\n"
    script = 'k3s-uninstall.sh' if is_server else 'k3s-agent-uninstall.sh'
    client = None
    try:
        client = _open_ssh_client(ip, username, key_path)
        yield _sse({'type': 'task', 'step': step_id,
                    'task': f'{name}: Running {script}…'})

        rc = None
        for line, code in _ssh_run_live(
                client, f'sudo /usr/local/bin/{script} 2>&1', timeout=120):
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

        # ── Docker cleanup ────────────────────────────────────────────────
        yield _sse({'type': 'task', 'step': step_id,
                    'task': f'{name}: Stopping and removing Docker containers…'})

        # Kill all running containers (ignore failure — none may be running)
        for line, _ in _ssh_run_live(
                client,
                'RUNNING=$(docker ps -q 2>/dev/null); [ -n "$RUNNING" ] && docker kill $RUNNING 2>&1 || true',
                timeout=60):
            if line is not None:
                yield _sse({'type': 'log', 'step': step_id, 'node': name, 'msg': line})

        # Remove all containers (stopped or just-killed)
        for line, _ in _ssh_run_live(
                client,
                'ALL=$(docker ps -aq 2>/dev/null); [ -n "$ALL" ] && docker rm -f $ALL 2>&1 || true',
                timeout=60):
            if line is not None:
                yield _sse({'type': 'log', 'step': step_id, 'node': name, 'msg': line})

        yield _sse({'type': 'log', 'step': step_id, 'node': name,
                    'msg': f'[{name}] Docker containers cleaned up.'})

        return rc if rc is not None else -1

    except Exception as exc:
        yield _sse({'type': 'task_warning', 'step': step_id,
                    'msg': f'[{name}] Error: {exc}'})
        return -1
    finally:
        if client:
            client.close()


# ── Main uninstall stream generator ──────────────────────────────────────

def _stream_k3s_uninstall(username: str, key_path: str):
    """Generator: uninstalls K3s from all nodes via SSH and yields SSE events.

    Order: workers → joining masters → primordial → local kubeconfig cleanup.
    """
    def _sse(d): return f"data: {json.dumps(d)}\n\n"

    try:
        nodes = _load_inventory()
        if not nodes:
            deploy_state.status = 'failed'
            yield _sse({'type': 'error', 'msg': 'No inventory found.'})
            return

        primordial      = next((n for n in nodes if n.get('primordial')), None)
        joining_masters = [n for n in nodes
                           if n.get('role') == 'master' and not n.get('primordial')]
        workers         = [n for n in nodes if n.get('role') == 'worker']

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
                if abort_flag.is_set():
                    break
                rc = yield from _gen_uninstall_node(
                    node['ip'], node['name'], username, key_path, False, 'workers')
                if rc != 0:
                    step_ok = False

            if abort_flag.is_set():
                deploy_state.status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if step_ok:
                yield _sse({'type': 'step_done', 'step': 'workers'})
            else:
                yield _sse({'type': 'step_failed', 'step': 'workers'})
                deploy_state.status = 'failed'
                yield _sse({'type': 'finished', 'success': False})
                return

        # ── Phase 2: Joining Masters ──────────────────────────────────────
        if joining_masters:
            yield _sse({'type': 'step_start', 'step': 'masters'})
            step_ok = True
            for node in joining_masters:
                if abort_flag.is_set():
                    break
                rc = yield from _gen_uninstall_node(
                    node['ip'], node['name'], username, key_path, True, 'masters')
                if rc != 0:
                    step_ok = False

            if abort_flag.is_set():
                deploy_state.status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if step_ok:
                yield _sse({'type': 'step_done', 'step': 'masters'})
            else:
                yield _sse({'type': 'step_failed', 'step': 'masters'})
                deploy_state.status = 'failed'
                yield _sse({'type': 'finished', 'success': False})
                return

        # ── Phase 3: Primordial Master ────────────────────────────────────
        if primordial:
            yield _sse({'type': 'step_start', 'step': 'primordial'})
            rc = yield from _gen_uninstall_node(
                primordial['ip'], primordial['name'], username, key_path, True, 'primordial')

            if abort_flag.is_set():
                deploy_state.status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if rc != 0:
                yield _sse({'type': 'step_failed', 'step': 'primordial'})
                deploy_state.status = 'failed'
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

        deploy_state.status = 'success'
        yield _sse({'type': 'finished', 'success': True})

    except Exception as exc:
        deploy_state.status = 'failed'
        yield _sse({'type': 'error', 'msg': str(exc)})
    finally:
        try:
            os.unlink(key_path)
        except OSError:
            pass


# ── Route ─────────────────────────────────────────────────────────────────

@uninstaller_bp.route('/uninstall', methods=['GET'])
def uninstall():
    username = request.args.get('username', '').strip()
    ssh_key  = request.args.get('ssh_key',  '').strip()

    if not username or not ssh_key:
        return jsonify({'status': 'error', 'message': 'Missing SSH credentials.'}), 400

    with proc_lock:
        if deploy_state.status == 'running':
            return jsonify({'status': 'error',
                            'message': 'A process is already running.'}), 409
        deploy_state.status = 'running'

    abort_flag.clear()
    key_path = _write_temp_key(ssh_key)

    def gen():
        yield from _stream_k3s_uninstall(username, key_path)

    return Response(gen(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
