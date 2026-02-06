#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="traefik"
RELEASE="traefik"
REPO_NAME="traefik"
REPO_URL="https://traefik.github.io/charts"
LB_FILE="traefik-lb.yaml"

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

# ------------------------------
# Add Traefik Helm repo
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
# Install or upgrade Traefik
# ------------------------------
log "Checking if Traefik release already exists..."

if helm status "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1; then
    warn "Traefik release already installed. Upgrading..."
    helm upgrade "$RELEASE" "$REPO_NAME/$RELEASE" \
        -n "$NAMESPACE" \
        --set service.type=ClusterIP \
        --set ports.web.expose=true \
        --set ports.websecure.expose=true \
        --set ports.traefik.expose=true \
        --set "additionalArguments={--api.dashboard=true,--api.insecure=true}" \
        --timeout 10m \
        --wait
else
    log "Installing Traefik..."
    helm install "$RELEASE" "$REPO_NAME/$RELEASE" \
        -n "$NAMESPACE" \
        --set service.type=ClusterIP \
        --set ports.web.expose=true \
        --set ports.websecure.expose=true \
        --set ports.traefik.expose=true \
        --set "additionalArguments={--api.dashboard=true,--api.insecure=true}" \
        --timeout 10m \
        --wait
fi

# ------------------------------
# Wait for Traefik to be ready
# ------------------------------
log "Waiting for Traefik deployment to be ready..."
kubectl -n "$NAMESPACE" rollout status deploy/traefik --timeout=180s

# ------------------------------
# Expose Traefik via MetalLB LoadBalancer
# ------------------------------
if [[ -f "$LB_FILE" ]]; then
    log "Applying Traefik LoadBalancer service from '$LB_FILE'..."
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
    EXTERNAL_IP=$(kubectl -n "$NAMESPACE" get svc traefik-lb -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
    if [[ -n "$EXTERNAL_IP" ]]; then
        break
    fi
    sleep 2
done

echo ""
log "============================================"
log "  Traefik installation complete!"
log "============================================"
if [[ -n "$EXTERNAL_IP" ]]; then
    log "  UI: http://${EXTERNAL_IP}:9000/dashboard/"
    log "  HTTP: http://${EXTERNAL_IP}"
    log "  HTTPS: https://${EXTERNAL_IP}"
else
    warn "  External IP not yet assigned. Check: kubectl -n $NAMESPACE get svc traefik-lb"
fi
log "  Dashboard is exposed insecurely (no auth)."
log "============================================"
