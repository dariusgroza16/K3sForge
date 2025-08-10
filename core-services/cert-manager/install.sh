#!/bin/bash

helm repo add jetstack https://charts.jetstack.io
helm repo update

kubectl create namespace cert-manager

helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --version v1.12.0 \
  --set installCRDs=true

kubectl apply -f cluster-issuer.yaml

