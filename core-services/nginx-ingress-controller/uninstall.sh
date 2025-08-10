#!/bin/bash

NAMESPACE="ingress-nginx"

echo "Uninstalling NGINX Ingress Controller Helm release..."
helm uninstall ingress-nginx -n ${NAMESPACE}

echo "Deleting namespace ${NAMESPACE}..."
kubectl delete namespace ${NAMESPACE} --wait=false
 
echo "NGINX Ingress Controller uninstalled and namespace deleted."
