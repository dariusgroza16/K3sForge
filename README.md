# Custer Watch

# Set Up
1. Cream cele 5 masini Virtuale de tip Ubuntu Server, toate au nevoie de un IP Static.

2. Oferim user-ului nostru drept de administrator fara nevoie a-i fi ceruta parola, adaugand in visudo linia "<user> ALL=(ALL:ALL) NOPASSWD: ALL"

3. Cream un SSH Key cu comanda "ssh-keygen -t rsa -b 4096"

4. Adaugam cate o intrare pentru fiecare server creat in fiesierul /etc/hosts pentru a asigna un nume fiecarui ip din lsita de servere "<ip.addres.sv1> <server.name>"

5. Adaugam cheia creata la pasul 3. pe taote cele 5 servere folosind comanda "ssh-copy-id <server.name>", urmand sa verificam ruland comanda "ssh <server.name>".

6. Ca un ultim pas in a pregati infrastructura si tool-urile necesare, mai trebuie sa instalam utilitarul "k3sup" ce ne va ajuta sa cream/configuram cluster-ul de k3s.
Rulam 

Acum ca avem infrastructura pregatita putem trece la rularea playbook-urile de ansible, ce va automatiza sarcinile.

