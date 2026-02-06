set export := true
set quiet := true
set shell := ["bash","-cu"]

this_dir := justfile_directory()

_default:
   just --list

[doc("Start the frontend for K3SForge")]
run:
  python3 $this_dir/frontend/src/main.py

[doc("Install K3S")]
ik: 
  cd ansible && \
  ansible-playbook -i inv playbooks/k3s-install.yaml

[doc("Uninstall K3S")]  
uk:
  cd ansible && \
  ansible-playbook -i inv playbooks/k3s-uninstall.yaml


# CORE SERVICES
[doc("Install MetalLB HelmChart")] 
metallb-install:
   cd core-services/metallb && \
   ./install.sh

[doc("Uninstall MetalLB HelmChart")] 
metallb-uninstall:
   cd core-services/metallb && \
   ./uninstall.sh

[doc("Install Traefik HelmChart")] 
traefik-install:
   cd core-services/traefik && \
   ./install.sh

[doc("Uninstall Traefik HelmChart")] 
traefik-uninstall:
   cd core-services/traefik && \
   ./uninstall.sh   

[doc("Install Rancher UI")] 
rancher-install:
   cd core-services/rancher && \
   ./install.sh

[doc("Uninstall Rancher UI")] 
rancher-uninstall:
   cd core-services/rancher && \
   ./uninstall.sh
