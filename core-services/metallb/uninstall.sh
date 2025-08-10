#!/bin/bash
helm uninstall metallb -n metallb-system && \
kubectl delete namespace metallb-system
