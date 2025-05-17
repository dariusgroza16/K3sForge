set export := true
set quiet := true
set shell := ["bash","-cu"]

this_dir := justfile_directory()

_default:
   just --list

[doc("Start the frontend for ClusterWatch")]
run:
  python3 $this_dir/frontend/src/frontend.py

[doc("Install ClusterWatch with k3s")]
ik: 
  ansible-playbook -i ansible/inv ansible/playbooks/k3s-install.yaml

[doc("Uninstall ClusterWatch with k3s")]  
uk:
  ansible-playbook -i ansible/inv ansible/playbooks/k3s-uninstall.yaml

