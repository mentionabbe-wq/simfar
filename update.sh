#!/usr/bin/env bash
# Update SimFar di server (CasaOS): tarik versi terbaru lalu rebuild & restart.
# Pakai: ./update.sh
set -e
cd "$(dirname "$0")"
echo "==> git pull"
git pull
echo "==> rebuild & restart container"
docker compose up -d --build
echo "==> selesai. Buka http://<IP-SERVER>:3000/"
