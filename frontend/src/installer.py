import json
import os
import re
import time

from flask import Blueprint, Response, jsonify, request
from jinja2 import Environment, FileSystemLoader

from config import K3S_TEMPLATES_DIR, abort_flag, deploy_state, proc_lock
from inventory import _load_inventory
from ssh import _open_ssh_client, _ssh_run_live, _write_temp_key

installer_bp = Blueprint('installer', __name__)

_jinja_env = None


def _get_jinja_env() -> Environment:
    global _jinja_env
    if _jinja_env is None:
        _jinja_env = Environment(
            loader=FileSystemLoader(K3S_TEMPLATES_DIR), autoescape=False)
    return _jinja_env


# ── Sub-generators ────────────────────────────────────────────────────────

def _gen_docker_on_node(ip: str, name: str, username: str, key_path: str):
    """Sub-generator: ensure Docker is installed on the node."""
    def _sse(d): return f"data: {json.dumps(d)}\n\n"
    client = None
    try:
        client = _open_ssh_client(ip, username, key_path)

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
                client, 'curl -fsSL https://get.docker.com | sudo sh 2>&1', timeout=300):
            if code is None:
                yield _sse({'type': 'log', 'step': 'docker', 'node': name, 'msg': line})
            else:
                rc = code

        if rc != 0:
            yield _sse({'type': 'task_warning', 'step': 'docker',
                        'msg': f'[{name}] Docker install script failed (rc={rc})'})
            return rc

        for _, _ in _ssh_run_live(
                client, 'sudo systemctl enable --now docker 2>&1', timeout=30):
            pass
        for _, _ in _ssh_run_live(
                client, f'sudo usermod -aG docker {username} 2>&1', timeout=10):
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


def _gen_k3s_on_node(ip: str, name: str, username: str, key_path: str,
                     config_content: str, install_args: str, step_id: str):
    """Sub-generator: upload /etc/rancher/k3s/config.yaml and run the installer."""
    def _sse(d): return f"data: {json.dumps(d)}\n\n"
    client = None
    try:
        client = _open_ssh_client(ip, username, key_path)

        yield _sse({'type': 'task', 'step': step_id, 'task': f'{name}: Uploading K3s config…'})
        stdin, stdout, _ = client.exec_command(
            'sudo mkdir -p /etc/rancher/k3s && sudo tee /etc/rancher/k3s/config.yaml',
            timeout=15,
        )
        stdin.write(config_content.encode('utf-8'))
        stdin.channel.shutdown_write()
        stdout.read()
        tee_rc = stdout.channel.recv_exit_status()
        if tee_rc != 0:
            yield _sse({'type': 'task_warning', 'step': step_id,
                        'msg': f'[{name}] Failed to write config.yaml (rc={tee_rc})'})
            return tee_rc

        yield _sse({'type': 'task', 'step': step_id, 'task': f'{name}: Running K3s installer…'})
        install_cmd = f'curl -sfL https://get.k3s.io | sudo sh -s - {install_args} 2>&1'
        rc = None
        for line, code in _ssh_run_live(client, install_cmd, timeout=600):
            if code is None:
                yield _sse({'type': 'log', 'step': step_id, 'node': name, 'msg': line})
            else:
                rc = code

        if abort_flag.is_set():
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


# ── Main install stream generator ─────────────────────────────────────────

def _stream_k3s_install(username: str, key_path: str, token: str, use_docker: bool):
    """Generator: installs K3s across all nodes via SSH and yields SSE events."""
    def _sse(d): return f"data: {json.dumps(d)}\n\n"

    try:
        nodes = _load_inventory()
        if not nodes:
            deploy_state.status = 'failed'
            yield _sse({'type': 'error', 'msg': 'No inventory found. Generate inventory first.'})
            return

        primordial = next((n for n in nodes if n.get('primordial')), None)
        if not primordial:
            deploy_state.status = 'failed'
            yield _sse({'type': 'error', 'msg': 'No primordial master defined in inventory.'})
            return

        joining_masters = [n for n in nodes if n.get('role') == 'master' and not n.get('primordial')]
        workers         = [n for n in nodes if n.get('role') == 'worker']
        all_nodes       = [primordial] + joining_masters + workers
        primordial_ip   = primordial['ip']

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

        env         = _get_jinja_env()
        master_tmpl = env.get_template('master.yaml.j2')
        worker_tmpl = env.get_template('worker.yaml.j2')

        # ── Phase 1: Docker ───────────────────────────────────────────────
        if use_docker:
            yield _sse({'type': 'step_start', 'step': 'docker'})
            step_ok = True
            for node in all_nodes:
                if abort_flag.is_set():
                    break
                rc = yield from _gen_docker_on_node(
                    node['ip'], node['name'], username, key_path)
                if rc != 0:
                    step_ok = False

            if abort_flag.is_set():
                deploy_state.status = 'aborted'
                yield _sse({'type': 'finished', 'success': False, 'aborted': True})
                return

            if step_ok:
                yield _sse({'type': 'step_done', 'step': 'docker'})
            else:
                yield _sse({'type': 'step_failed', 'step': 'docker'})
                deploy_state.status = 'failed'
                yield _sse({'type': 'finished', 'success': False})
                return

        # ── Phase 2: Primordial Master ────────────────────────────────────
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

        if abort_flag.is_set():
            deploy_state.status = 'aborted'
            yield _sse({'type': 'finished', 'success': False, 'aborted': True})
            return

        if rc != 0:
            yield _sse({'type': 'step_failed', 'step': 'primordial'})
            deploy_state.status = 'failed'
            yield _sse({'type': 'finished', 'success': False})
            return

        yield _sse({'type': 'task', 'step': 'primordial', 'task': 'Waiting for API server…'})
        api_ready   = False
        wait_client = _open_ssh_client(primordial_ip, username, key_path)
        try:
            for _ in range(24):
                if abort_flag.is_set():
                    break
                wait_rc = None
                for _, code in _ssh_run_live(
                        wait_client, 'sudo k3s kubectl get nodes 2>&1', timeout=15):
                    if code is not None:
                        wait_rc = code
                if wait_rc == 0:
                    api_ready = True
                    break
                time.sleep(5)
        finally:
            wait_client.close()

        if abort_flag.is_set():
            deploy_state.status = 'aborted'
            yield _sse({'type': 'finished', 'success': False, 'aborted': True})
            return

        if not api_ready:
            yield _sse({'type': 'step_failed', 'step': 'primordial'})
            deploy_state.status = 'failed'
            yield _sse({'type': 'finished', 'success': False})
            return

        yield _sse({'type': 'step_done', 'step': 'primordial'})

        # ── Phase 3: Retrieve Kubeconfig ──────────────────────────────────
        yield _sse({'type': 'step_start', 'step': 'kubeconfig'})
        yield _sse({'type': 'task', 'step': 'kubeconfig', 'task': 'Fetching kubeconfig…'})
        kube_client = _open_ssh_client(primordial_ip, username, key_path)
        try:
            _, stdout, _ = kube_client.exec_command(
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
                if abort_flag.is_set():
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

        # ── Phase 5: Join Workers ─────────────────────────────────────────
        if workers:
            yield _sse({'type': 'step_start', 'step': 'workers'})
            step_ok = True
            for node in workers:
                if abort_flag.is_set():
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


# ── Routes ────────────────────────────────────────────────────────────────

@installer_bp.route('/deploy', methods=['GET'])
def deploy():
    username = request.args.get('username', '').strip()
    ssh_key  = request.args.get('ssh_key',  '').strip()
    token    = request.args.get('token',    '').strip()
    docker   = request.args.get('docker', 'false').lower() == 'true'

    if not username or not ssh_key:
        return jsonify({'status': 'error', 'message': 'Missing SSH credentials.'}), 400
    if not token:
        return jsonify({'status': 'error', 'message': 'Missing cluster token.'}), 400

    with proc_lock:
        if deploy_state.status == 'running':
            return jsonify({'status': 'error',
                            'message': 'A deploy/uninstall is already running.'}), 409
        deploy_state.status = 'running'

    abort_flag.clear()
    key_path = _write_temp_key(ssh_key)

    def gen():
        yield from _stream_k3s_install(username, key_path, token, docker)

    return Response(gen(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})


@installer_bp.route('/deploy-abort', methods=['POST'])
def deploy_abort():
    abort_flag.set()
    with proc_lock:
        if deploy_state.current_proc is not None:
            deploy_state.status = 'aborted'
            try:
                import signal
                os.killpg(os.getpgid(deploy_state.current_proc.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
    return jsonify({'status': 'success', 'message': 'Abort signal sent.'})


@installer_bp.route('/deploy-status', methods=['GET'])
def deploy_status():
    return jsonify({'status': deploy_state.status})
