# Repository Context — K3sForge

Last updated: 2026-02-06
Maintainer (initial entry): GitHub Copilot (assistant)

## Short description
K3sForge is a collection of Ansible playbooks, scripts, and supporting files to install and manage lightweight Kubernetes (k3s) clusters, plus a small frontend for status/interaction. It includes HAProxy and MetalLB support and helper roles for Docker and node provisioning.

## Key areas of the repository
- `ansible/` — Ansible playbooks and roles to install/uninstall k3s, HAProxy, Docker, and retrieve kubeconfig.
- `core-services/metallb/` — scripts and YAML for MetalLB installation and IP pool configuration.
- `frontend/` — a minimal Python/Flask (or similar) app in `src/` with static assets and templates used for a UI.
- `Dockerfile`, `docker-compose.yml` — containerization and local service orchestration.
- `README.md` — high-level repo documentation and usage hints.

## Purpose / Goals
- Provide repeatable playbooks to provision a k3s cluster (masters + workers) and HAProxy for load balancing.
- Offer a lightweight frontend for status or orchestrator interactions.
- Be a single-source repo for cluster bootstrap automation and small demo workflows.

## Languages & Tools present
- Ansible (playbooks and roles)
- Bash scripts
- Python (frontend)
- JavaScript/CSS for static UI
- Docker/Docker Compose

## Where to look first
- For cluster installation flows: `ansible/playbooks/k3s-install.yaml` and the roles under `ansible/roles/`.
- For HAProxy config and install: `ansible/roles/haproxy-install/templates/haproxy.cfg` and related playbooks.
- For MetalLB setup: `core-services/metallb/install.sh` and `metallb-ip-pool.yaml`.

## Update policy for this context file
This file is intended to be a living summary that the assistant will append to as we make progress. Each entry should follow this format:

```
YYYY-MM-DD — Actor — Short description of change or observation
- Details (optional, 1-2 lines)
```

Examples of entries:
```
2026-02-06 — Assistant — Created initial context file summarizing repository.
- Added sections: short description, key areas, purpose, languages, where to look first, and update policy.
```

## Important rule — Clarification policy
The assistant will NOT make assumptions about intent or actions. Before performing any non-trivial change (code edits, runs, deployments, commits), the assistant will ask explicit clarifying questions and wait for user confirmation.

When you (the user) interact with the assistant, you can request:
- "Proceed" to allow a suggested change, or
- "Ask first" to require explicit step-by-step confirmation.

Current default: Ask first for clarifications and confirmation before taking actions.

## History
2026-02-06 — Assistant — Created initial context file.
- Summarized repository structure and set clarification policy.

---

If you'd like different naming, file location, or an alternate structured format (JSON/YAML), tell me which and I'll convert this file. If you want me to commit this to git and create a commit message, I can do that next (I'll ask before committing).