#!/usr/bin/env bash
# Provisioning inicial — Ubuntu 24.04, VPS Hostinger
# Uso: ssh root@TU_IP, luego pegar/correr este script como root.
set -euo pipefail

echo "== 1/7 Actualizando sistema =="
apt update && apt upgrade -y
apt install -y curl git ufw build-essential

echo "== 2/7 Firewall =="
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "== 3/7 Node.js 22 LTS =="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2

echo "== 4/7 PostgreSQL + PostGIS =="
apt install -y postgresql postgresql-contrib postgis postgresql-16-postgis-3
systemctl enable --now postgresql

DB_NAME="inteligencia_inmobiliaria"
DB_USER="iimx_app"
DB_PASS="$(openssl rand -base64 24)"

sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME};"
sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH ENCRYPTED PASSWORD '${DB_PASS}';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
sudo -u postgres psql -d "${DB_NAME}" -c "GRANT ALL ON SCHEMA public TO ${DB_USER};"

echo "== 5/7 Nginx + Certbot =="
apt install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx

echo "== 6/7 Carpeta de la app =="
mkdir -p /var/www/iimx
chown -R "$(logname)":"$(logname)" /var/www/iimx 2>/dev/null || true

echo "== 7/7 Listo =="
cat <<EOF

Provisioning completo.

  DB_NAME=${DB_NAME}
  DB_USER=${DB_USER}
  DB_PASS=${DB_PASS}
  DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}

Guarda DATABASE_URL — la pide el backend y crawler/.env.

Próximos pasos manuales:
  1. Subir el repo a /var/www/iimx (git clone o scp)
  2. psql "\${DATABASE_URL}" -f database/schema.sql
  3. cd crawler && cp .env.example .env  (pegar DATABASE_URL) && npm install
  4. pm2 start "npm run start" --name crawler --cwd /var/www/iimx/crawler
  5. Configurar Nginx server block + certbot --nginx -d tudominio.com
  6. pm2 startup && pm2 save
EOF
