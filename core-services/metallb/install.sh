#!/bin/bash
# Add repo & install MetalLB
helm repo add metallb https://metallb.github.io/metallb
helm repo update
helm install metallb metallb/metallb -n metallb-system --create-namespace


kubectl apply -f metallb-ip-pool.yaml && \
echo "MetalLB Helm installed and applied"
