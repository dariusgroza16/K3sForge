#!/bin/bash
set -e

# Uninstall cert-manager Helm release
helm uninstall cert-manager -n cert-manager || true

# Delete cert-manager namespace and wait for cleanup
kubectl delete namespace cert-manager --wait=true || true

echo "cert-manager uninstalled successfully!"
