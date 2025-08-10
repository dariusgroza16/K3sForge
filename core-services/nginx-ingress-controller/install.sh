#!/bin/bash

set -e

NAMESPACE="ingress-nginx"

echo "Adding NGINX Ingress Controller Helm repo..."
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

echo "Creating namespace ${NAMESPACE} if not exists..."
kubectl get ns ${NAMESPACE} >/dev/null 2>&1 || kubectl create namespace ${NAMESPACE}

echo "Installing or upgrading NGINX Ingress Controller..."
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ${NAMESPACE} \
  --set controller.service.type=LoadBalancer \
  --set controller.replicaCount=1 \
  --set controller.admissionWebhooks.enabled=true \
  --wait

echo "NGINX Ingress Controller installed successfully in namespace ${NAMESPACE}."
echo "Run 'kubectl get svc -n ${NAMESPACE}' to see the LoadBalancer IP assigned by MetalLB."
