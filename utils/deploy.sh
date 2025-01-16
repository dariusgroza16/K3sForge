ssh -o StrictHostKeyChecking=no -t dariusmurk@192.168.1.201 "curl -sfL https://get.k3s.io | sudo sh -s - server --cluster-init --tls-san 192.168.1.201"


ssh -o StrictHostKeyChecking=no -t dariusmurk@192.168.1.201 "sudo cat /var/lib/rancher/k3s/server/node-token" --> get token

K10820b9afcce3bd6822c491dfd2632195c1cf8f7341e660a39b1bb3675c39c2f43::server:971932eabb4fd2ad30755473ee4c0ea3

ssh -o StrictHostKeyChecking=no -t dariusmurk@192.168.1.202 "curl -sfL https://get.k3s.io | sudo sh -s - server --server https://192.168.1.201:6443 --token K10820b9afcce3bd6822c491dfd2632195c1cf8f7341e660a39b1bb3675c39c2f43::server:971932eabb4fd2ad30755473ee4c0ea3 --tls-san 192.168.1.201"

ssh -o StrictHostKeyChecking=no -t dariusmurk@192.168.1.203 "curl -sfL https://get.k3s.io | sudo sh -s - server --server https://192.168.1.201:6443 --token K10820b9afcce3bd6822c491dfd2632195c1cf8f7341e660a39b1bb3675c39c2f43::server:971932eabb4fd2ad30755473ee4c0ea3 --tls-san 192.168.1.201"


ssh -o StrictHostKeyChecking=no -t dariusmurk@192.168.1.204 "curl -sfL https://get.k3s.io | K3S_URL=https://192.168.1.201:6443 K3S_TOKEN=K10820b9afcce3bd6822c491dfd2632195c1cf8f7341e660a39b1bb3675c39c2f43::server:971932eabb4fd2ad30755473ee4c0ea3 sudo sh -"

ssh -o StrictHostKeyChecking=no -t dariusmurk@192.168.1.205 "curl -sfL https://get.k3s.io | K3S_URL=https://192.168.1.201:6443 K3S_TOKEN=K10820b9afcce3bd6822c491dfd2632195c1cf8f7341e660a39b1bb3675c39c2f43::server:971932eabb4fd2ad30755473ee4c0ea3 sudo sh -"