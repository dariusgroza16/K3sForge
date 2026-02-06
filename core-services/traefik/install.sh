#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="kube-system"
HELMCHART_FILE="traefik-helmchart.yaml"

log() {
  echo -e "\e[32m[INFO]\e[0m $1"
}

warn() {
  echo -e "\e[33m[WARN]\e[0m $1"
}

error() {
  echo -e "\e[31m[ERROR]\e[0m $1"
}

# ------------------------------
# Check if HelmChart file exists
# ------------------------------
if [[ ! -f "$HELMCHART_FILE" ]]; then
    error "HelmChart manifest '$HELMCHART_FILE' not found."
    exit 1
fi

# ------------------------------
# Apply Traefik HelmChart
# ------------------------------
log "Applying Traefik HelmChart manifest..."
kubectl apply -f "$HELMCHART_FILE"

# ------------------------------
# Wait for Traefik deployment
# ------------------------------
log "Waiting for Traefik deployment to be ready..."
kubectl -n "$NAMESPACE" rollout status deploy/traefik --timeout=180s || {
    warn "Traefik deployment not ready yet. You may need to check the HelmChart status."
}

# ------------------------------
# Display service information
# ------------------------------
log "Checking Traefik service status..."
kubectl -n "$NAMESPACE" get svc traefik || warn "Traefik service not found yet."

log "Traefik installation complete."
log "Access the dashboard at: http://traefik-ui.local (ensure DNS/hosts file is configured)"
