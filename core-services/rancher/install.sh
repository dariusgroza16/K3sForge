#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="cattle-system"
RELEASE="rancher"
REPO_NAME="rancher-latest"
REPO_URL="https://releases.rancher.com/server-charts/latest"
CERT_MANAGER_VERSION="v1.17.1"
CERT_MANAGER_NAMESPACE="cert-manager"
RANCHER_HOSTNAME="${RANCHER_HOSTNAME:-rancher.suirad.dev}"
LB_FILE="rancher-lb.yaml"

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
# Pre-flight: ensure K8s API is stable
# ------------------------------
log "Waiting for Kubernetes API to be fully healthy..."
for i in $(seq 1 30); do
    if kubectl get --raw /healthz >/dev/null 2>&1; then
        break
    fi
    if [[ $i -eq 30 ]]; then
        error "Kubernetes API not healthy after 60s. Aborting."
        exit 1
    fi
    sleep 2
done
log "Kubernetes API is healthy."

# Ensure core components are ready
log "Waiting for coredns to be ready..."
kubectl -n kube-system rollout status deploy/coredns --timeout=120s 2>/dev/null || true

# ------------------------------
# Install cert-manager (required by Rancher)
# ------------------------------
log "Checking if cert-manager is already installed..."

if helm status cert-manager -n "$CERT_MANAGER_NAMESPACE" >/dev/null 2>&1; then
    log "cert-manager already installed. Skipping."
else
    log "Adding jetstack Helm repo..."
    helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
    helm repo update >/dev/null

    log "Installing cert-manager $CERT_MANAGER_VERSION..."
    kubectl apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.crds.yaml"

    kubectl create namespace "$CERT_MANAGER_NAMESPACE" 2>/dev/null || true

    helm install cert-manager jetstack/cert-manager \
        -n "$CERT_MANAGER_NAMESPACE" \
        --version "$CERT_MANAGER_VERSION" \
        --timeout 5m \
        --wait

    log "Waiting for cert-manager deployments to be ready..."
    kubectl -n "$CERT_MANAGER_NAMESPACE" rollout status deploy/cert-manager --timeout=120s
    kubectl -n "$CERT_MANAGER_NAMESPACE" rollout status deploy/cert-manager-cainjector --timeout=120s
    kubectl -n "$CERT_MANAGER_NAMESPACE" rollout status deploy/cert-manager-webhook --timeout=120s

    # Give the webhook a moment to start serving
    log "Waiting for cert-manager webhook to be responsive..."
    for i in $(seq 1 20); do
        if kubectl get apiservice v1.cert-manager.io -o jsonpath='{.status.conditions[0].status}' 2>/dev/null | grep -q True; then
            break
        fi
        sleep 3
    done
fi

# ------------------------------
# Add Rancher Helm repo
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
# Install or upgrade Rancher
# ------------------------------
log "Checking if Rancher release already exists..."

if helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    warn "Rancher release already installed. Upgrading..."
    helm upgrade "$RELEASE" "$REPO_NAME/$RELEASE" \
        -n "$NAMESPACE" \
        --set hostname="$RANCHER_HOSTNAME" \
        --set replicas=1 \
        --set ingress.enabled=false \
        --set tls=rancher \
        --set bootstrapPassword=admin \
        --timeout 10m \
        --wait
else
    log "Installing Rancher (hostname=$RANCHER_HOSTNAME)..."
    helm install "$RELEASE" "$REPO_NAME/$RELEASE" \
        -n "$NAMESPACE" \
        --set hostname="$RANCHER_HOSTNAME" \
        --set replicas=1 \
        --set ingress.enabled=false \
        --set tls=rancher \
        --set bootstrapPassword=admin \
        --timeout 10m \
        --wait
fi

# ------------------------------
# Wait for Rancher to be ready
# ------------------------------
log "Waiting for Rancher deployment to be ready..."
kubectl -n "$NAMESPACE" rollout status deploy/rancher --timeout=300s

# ------------------------------
# Expose Rancher via MetalLB LoadBalancer
# ------------------------------
if [[ -f "$LB_FILE" ]]; then
    log "Applying Rancher LoadBalancer service from '$LB_FILE'..."
    kubectl apply -f "$LB_FILE"
else
    warn "LoadBalancer file '$LB_FILE' not found. Skipping."
fi

# ------------------------------
# Print access info
# ------------------------------
log "Waiting for MetalLB to assign an external IP..."
EXTERNAL_IP=""
for i in $(seq 1 30); do
    EXTERNAL_IP=$(kubectl -n "$NAMESPACE" get svc rancher-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
    if [[ -n "$EXTERNAL_IP" ]]; then
        break
    fi
    sleep 2
done

# Get bootstrap password
BOOTSTRAP_PWD="admin"

echo ""
log "============================================"
log "  Rancher installation complete!"
log "============================================"
if [[ -n "$EXTERNAL_IP" ]]; then
    log "  UI: https://${EXTERNAL_IP}"
else
    warn "  External IP not yet assigned. Check: kubectl -n $NAMESPACE get svc rancher-lb"
fi
log "  Bootstrap password: $BOOTSTRAP_PWD"
log "  (Use the password above on first login)"
log "============================================"
