#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="traefik"
RELEASE="traefik"
REPO_NAME="traefik"

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
# Delete the LoadBalancer service
# ------------------------------
if kubectl get svc traefik-lb -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Deleting Traefik LoadBalancer service..."
    kubectl delete svc traefik-lb -n "$NAMESPACE"
else
    log "Traefik LoadBalancer service not found (already removed)."
fi

# ------------------------------
# Uninstall Traefik Helm release
# ------------------------------
if helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Uninstalling Helm release '$RELEASE'..."
    helm uninstall "$RELEASE" -n "$NAMESPACE" --wait
else
    warn "Helm release '$RELEASE' not found (already removed)."
fi

# ------------------------------
# Clean up namespace
# ------------------------------
if kubectl get ns "$NAMESPACE" >/dev/null 2>&1; then
    log "Deleting namespace '$NAMESPACE'..."
    kubectl delete namespace "$NAMESPACE" --wait=true --timeout=120s || true
else
    log "Namespace '$NAMESPACE' not found (already removed)."
fi

# ------------------------------
# Remove Helm repo
# ------------------------------
if helm repo list 2>/dev/null | grep -q "^$REPO_NAME"; then
    log "Removing Helm repo '$REPO_NAME'..."
    helm repo remove "$REPO_NAME"
else
    warn "Helm repo '$REPO_NAME' is not configured."
fi

log "Traefik uninstall complete."
