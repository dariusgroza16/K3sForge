#!/bin/bash


#Your varaibles
export floating_ip=192.168.1.20 #This will be a virtula ip so it MUST NOT be assigned to any device/machine

#IP of your machines
export master1_ip=192.168.1.201
export master2_ip=192.168.1.202
export master3_ip=192.168.1.203
export worker1_ip=192.168.1.204
export worker2_ip=192.168.1.205

export main_interface_name=eth0


#First we will install kubectl
# Check if kubectl is already installed
if command -v kubectl &> /dev/null; then
    echo "kubectl is already installed"
else
    # Download the latest stable version of kubectl
    echo "Downloading kubectl..."
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
    
    # Make kubectl executable
    chmod +x kubectl
    
    # Move kubectl to /usr/local/bin
    sudo mv kubectl /usr/local/bin/
    
    echo "kubectl has been installed successfully"
fi

# Check if k3sup is installed
if ! command -v k3sup &> /dev/null; then
    echo "k3sup is not installed. Installing now..."

    # Install k3sup
    curl -sLS https://get.k3sup.dev | sh
    
    # Move the binary to /usr/local/bin if needed
    sudo install k3sup /usr/local/bin/

    # Verify installation
    if command -v k3sup &> /dev/null; then
        echo "k3sup was successfully installed."
        rm k3sup 
    else
        echo "There was an issue installing k3sup."
    fi
else
    echo "k3sup is already installed."
fi


# #Preparing first node 
mkdir -p ~/.kube

k3sup install --ip $master1_ip \
--user $USER \
--sudo \
--tls-san $floating_ip \
 --cluster --local-path ~/.kube/k3s-cluster.yaml \
 --context k8s-cluster-ha \
 --k3s-extra-args "--disable traefik --disable servicelb --node-ip=$master1_ip"

chmod 666 ~/.kube/k3s-cluster.yaml
export KUBECONFIG=~/.kube/k3s-cluster.yaml
# Define the line to add
KUBECONFIG_LINE='export KUBECONFIG=~/.kube/k3s-cluster.yaml'

# Check if the line already exists in .bashrc
if ! grep -qF "$KUBECONFIG_LINE" ~/.bashrc; then
    # If not found, append the line to .bashrc
    echo "$KUBECONFIG_LINE" >> ~/.bashrc
    echo "Added KUBECONFIG to .bashrc"
else
    echo "KUBECONFIG line already exists in .bashrc"
fi

kubectl apply -f https://kube-vip.io/manifests/rbac.yaml 

# COMMANDS="sudo -i; \
# ctr image pull docker.io/plndr/kube-vip:latest; \
# alias kube-vip="ctr run --rm --net-host docker.io/plndr/kube-vip:latest vip /kube-vip"; \
# kube-vip manifest daemonset \
# --arp \
# --interface ens192 \
# --address 192.168.1.20 \
# --controlplane \
# --leaderElection \
# --taint \
# --inCluster | tee /var/lib/rancher/k3s/server/manifests/kube-vip.yaml;"  

# ssh $USER@$master1_ip "$COMMANDS"

#Other masters Joining to kluster
# k3sup join --ip $master2_ip --user $USER --sudo --k3s-channel stable --server --server-ip $floating_ip --server-user $USER --sudo --k3s-extra-args "--disable traefik  --disable servicelb --node-ip=$master2_ip"
# k3sup join --ip $master3_ip --user $USER --sudo --k3s-channel stable --server --server-ip $floating_ip --server-user $USER --sudo --k3s-extra-args "--disable traefik  --disable servicelb --node-ip=$master3_ip"

# #Workers Joining the kluster
# k3sup join --user $USER --sudo --server-ip $floating_ip --ip $worker1_ip --k3s-channel stable -- --k3s-extra-args "--disable traefik --disable servicelb" --print-command
# k3sup join --user $USER --sudo --server-ip $floating_ip --ip $worker2_ip --k3s-channel stable -- --k3s-extra-args "--disable traefik --disable servicelb" --print-command
