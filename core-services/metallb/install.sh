#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="metallb-system"
RELEASE="metallb"
REPO_NAME="metallb"
REPO_URL="https://metallb.github.io/metallb"
IPPOOL_FILE="metallb-ip-pool.yaml"

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
# Check Helm repo
# ------------------------------
log "Checking if Helm repo '$REPO_NAME' exists..."

if helm repo list | grep -q "^$REPO_NAME"; then
    log "Helm repo '$REPO_NAME' already exists. Updating..."
    helm repo update >/dev/null
else
    log "Adding Helm repo '$REPO_NAME'..."
    helm repo add "$REPO_NAME" "$REPO_URL" >/dev/null
    helm repo update >/dev/null
fi

# ------------------------------
# Ensure namespace exists
# ------------------------------
if kubectl get ns "$NAMESPACE" >/dev/null 2>&1; then
    log "Namespace '$NAMESPACE' already exists."
else
    log "Creating namespace '$NAMESPACE'..."
    kubectl create namespace "$NAMESPACE"
fi

# ------------------------------
# Install or upgrade MetalLB
# ------------------------------
log "Checking if MetalLB release already exists..."

if helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    warn "MetalLB release already installed. Upgrading instead..."
    helm upgrade "$RELEASE" "$REPO_NAME/$RELEASE" -n "$NAMESPACE"
else
    log "Installing MetalLB..."
    helm install "$RELEASE" "$REPO_NAME/$RELEASE" -n "$NAMESPACE"
fi

# ------------------------------
# Wait for MetalLB components
# ------------------------------
log "Waiting for MetalLB controller Deployment to be ready..."
kubectl -n "$NAMESPACE" rollout status deploy/metallb-controller --timeout=180s

log "Waiting for MetalLB speaker DaemonSet to be ready..."
kubectl -n "$NAMESPACE" rollout status daemonset/metallb-speaker --timeout=180s

# ------------------------------
# Apply the MetalLB IP Address Pool
# ------------------------------
if [[ -f "$IPPOOL_FILE" ]]; then
    log "Applying MetalLB IP address pool from '$IPPOOL_FILE'..."
    kubectl apply -f "$IPPOOL_FILE"
else
    warn "IP pool file '$IPPOOL_FILE' not found. Skipping."
fi

log "MetalLB installation complete and IP pool applied successfully."
