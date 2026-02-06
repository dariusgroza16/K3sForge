#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="kube-system"
HELMCHART_NAME="traefik"
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
# Delete Traefik HelmChart
# ------------------------------
if kubectl get helmchart "$HELMCHART_NAME" -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Deleting Traefik HelmChart resource..."
    kubectl delete helmchart "$HELMCHART_NAME" -n "$NAMESPACE"
else
    warn "HelmChart '$HELMCHART_NAME' not found in namespace '$NAMESPACE' (already removed)."
fi

# ------------------------------
# Wait for resources to be cleaned up
# ------------------------------
log "Waiting for Traefik deployment to be removed..."
kubectl -n "$NAMESPACE" wait --for=delete deployment/traefik --timeout=60s 2>/dev/null || {
    warn "Traefik deployment may have already been removed."
}

# ------------------------------
# Clean up any leftover resources
# ------------------------------
log "Cleaning up remaining Traefik resources..."

# Delete service
kubectl -n "$NAMESPACE" delete svc traefik --ignore-not-found=true

# Delete service account
kubectl -n "$NAMESPACE" delete serviceaccount traefik --ignore-not-found=true

# Delete cluster role and binding
kubectl delete clusterrole traefik-kube-system --ignore-not-found=true
kubectl delete clusterrolebinding traefik-kube-system --ignore-not-found=true

# Delete IngressRoute for dashboard
kubectl -n "$NAMESPACE" delete ingressroute traefik-dashboard --ignore-not-found=true

# ------------------------------
# Clean up CRDs (optional - only if you want full removal)
# ------------------------------
log "Checking for Traefik CRDs..."
TRAEFIK_CRDS=$(kubectl get crds | grep traefik.io | awk '{print $1}' || true)

if [[ -n "$TRAEFIK_CRDS" ]]; then
    warn "Traefik CRDs found. These are typically shared resources."
    warn "To remove CRDs, run: kubectl delete crd \$(kubectl get crds | grep traefik.io | awk '{print \$1}')"
else
    log "No Traefik CRDs found or already removed."
fi

log "Traefik uninstall complete. Core resources cleaned."
