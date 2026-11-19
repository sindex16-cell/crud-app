#!/bin/bash
# Run with: sudo ./deploy.sh
set -e
cd "$(dirname "$0")"
cp crud-app.service /etc/systemd/system/crud-app.service
cp nginx-crud-app.conf /etc/nginx/sites-available/crud-app
ln -sf /etc/nginx/sites-available/crud-app /etc/nginx/sites-enabled/crud-app
echo "Disable the default nginx site (it also uses default_server)."
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl daemon-reload
systemctl enable crud-app
systemctl restart crud-app
systemctl reload nginx
echo "Done."
