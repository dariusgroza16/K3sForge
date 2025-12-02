#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="metallb-system"
RELEASE="metallb"
REPO_NAME="metallb"

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
# Uninstall Helm release
# ------------------------------
if helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Uninstalling Helm release '$RELEASE'..."
    helm uninstall "$RELEASE" -n "$NAMESPACE"
else
    warn "Helm release '$RELEASE' not found (already removed)."
fi

# ------------------------------
# Remove stuck finalizers
# ------------------------------
log "Checking for leftover MetalLB CRDs with finalizers..."

CRDS=$(kubectl get crds | grep metallb.io | awk '{print $1}' || true)

if [[ -n "$CRDS" ]]; then
    for crd in $CRDS; do
        log "Removing finalizers from $crd"
        kubectl get "$crd" -o name | while read -r obj; do
            kubectl patch "$obj" --type=merge -p '{"metadata":{"finalizers": []}}' || true
        done
    done
else
    log "No MetalLB CRDs found."
fi

# ------------------------------
# Delete namespace
# ------------------------------
if kubectl get ns "$NAMESPACE" >/dev/null 2>&1; then
    log "Deleting namespace '$NAMESPACE'..."
    kubectl delete namespace "$NAMESPACE" --wait=true
else
    warn "Namespace '$NAMESPACE' not found (already removed)."
fi

# ------------------------------
# Delete MetalLB CRDs explicitly
# ------------------------------
log "Deleting MetalLB CRDs (if they still exist)..."

kubectl delete crd ipaddresspools.metallb.io --ignore-not-found=true
kubectl delete crd l2advertisements.metallb.io --ignore-not-found=true
kubectl delete crd bgppeers.metallb.io --ignore-not-found=true
kubectl delete crd bgpadvertisements.metallb.io --ignore-not-found=true
kubectl delete crd communities.metallb.io --ignore-not-found=true

# ------------------------------
# Delete webhooks (in case they remain)
# ------------------------------
log "Cleaning up leftover webhook configurations..."

kubectl delete validatingwebhookconfiguration metallb-webhook-configuration --ignore-not-found=true
kubectl delete mutatingwebhookconfiguration metallb-webhook-configuration --ignore-not-found=true

# ------------------------------
# Remove Helm repo
# ------------------------------
if helm repo list | grep -q "^$REPO_NAME"; then
    log "Removing Helm repo '$REPO_NAME'..."
    helm repo remove "$REPO_NAME"
else
    warn "Helm repo '$REPO_NAME' is not configured."
fi

log "MetalLB uninstall complete. All resources cleaned."
