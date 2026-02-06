#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="cattle-system"
RELEASE="rancher"
REPO_NAME="rancher-latest"
CERT_MANAGER_NAMESPACE="cert-manager"

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
if kubectl get svc rancher-lb -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Deleting Rancher LoadBalancer service..."
    kubectl delete svc rancher-lb -n "$NAMESPACE"
else
    log "Rancher LoadBalancer service not found (already removed)."
fi

# ------------------------------
# Uninstall Rancher Helm release
# ------------------------------
if helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    log "Uninstalling Helm release '$RELEASE'..."
    helm uninstall "$RELEASE" -n "$NAMESPACE" --wait
else
    warn "Helm release '$RELEASE' not found (already removed)."
fi

# ------------------------------
# Clean up Rancher namespace
# ------------------------------
if kubectl get ns "$NAMESPACE" >/dev/null 2>&1; then
    log "Deleting namespace '$NAMESPACE'..."
    kubectl delete namespace "$NAMESPACE" --wait=true --timeout=120s || true
else
    log "Namespace '$NAMESPACE' not found (already removed)."
fi

# Clean up additional Rancher-created namespaces
for ns in cattle-fleet-system cattle-fleet-local-system cattle-global-data cattle-global-nt fleet-default fleet-local local; do
    if kubectl get ns "$ns" >/dev/null 2>&1; then
        log "Deleting Rancher-managed namespace '$ns'..."
        kubectl delete namespace "$ns" --wait=false || true
    fi
done

# ------------------------------
# Remove Rancher CRDs
# ------------------------------
log "Removing Rancher CRDs..."
kubectl get crds -o name | grep -E 'cattle\.io|fleet\.io|rancher\.io|provisioning\.cattle\.io' | while read -r crd; do
    log "Deleting $crd"
    kubectl delete "$crd" --timeout=30s 2>/dev/null || true
done

# ------------------------------
# Remove Rancher ClusterRoles / Bindings
# ------------------------------
log "Cleaning up Rancher ClusterRoles and ClusterRoleBindings..."
kubectl get clusterroles -o name | grep -i rancher | while read -r cr; do
    kubectl delete "$cr" 2>/dev/null || true
done
kubectl get clusterrolebindings -o name | grep -i rancher | while read -r crb; do
    kubectl delete "$crb" 2>/dev/null || true
done

# ------------------------------
# Uninstall cert-manager (optional)
# ------------------------------
if helm status cert-manager -n "$CERT_MANAGER_NAMESPACE" >/dev/null 2>&1; then
    log "Uninstalling cert-manager..."
    helm uninstall cert-manager -n "$CERT_MANAGER_NAMESPACE" --wait

    log "Removing cert-manager CRDs..."
    kubectl get crds -o name | grep cert-manager.io | while read -r crd; do
        kubectl delete "$crd" --timeout=30s 2>/dev/null || true
    done

    if kubectl get ns "$CERT_MANAGER_NAMESPACE" >/dev/null 2>&1; then
        log "Deleting namespace '$CERT_MANAGER_NAMESPACE'..."
        kubectl delete namespace "$CERT_MANAGER_NAMESPACE" --wait=true --timeout=60s || true
    fi
else
    log "cert-manager not installed. Skipping."
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

log "Rancher uninstall complete. All resources cleaned."
