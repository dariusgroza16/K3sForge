import os
import time
import tempfile

import paramiko

from config import abort_flag


def _write_temp_key(ssh_key_text: str) -> str:
    """Write an SSH private key to a temp file and return its path."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='_k3sforge_key', mode='w')
    tmp.write(ssh_key_text.strip() + '\n')
    tmp.close()
    os.chmod(tmp.name, 0o600)
    return tmp.name


def _open_ssh_client(ip: str, username: str, key_path: str,
                     connect_timeout: int = 30) -> paramiko.SSHClient:
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
    """Run *cmd* on the remote and yield (line, None) per output line,
    then (None, exit_code) once the command finishes.
    Non-blocking so the abort_flag is checked on every iteration.
    """
    transport = client.get_transport()
    chan = transport.open_session()
    chan.set_combine_stderr(True)
    chan.setblocking(False)
    chan.exec_command(cmd)

    buf      = ''
    deadline = time.monotonic() + timeout

    while not chan.exit_status_ready():
        if abort_flag.is_set():
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

    # Drain remaining buffered output
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
