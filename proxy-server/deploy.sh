#!/usr/bin/env bash
# RCDN proxy - one-shot deploy for Ubuntu/Debian (Oracle free tier, VPS, etc.)
# Run:  sudo bash deploy.sh
set -euo pipefail

# ---- config ----
PORT="${PORT:-3000}"
APP_DIR="/opt/rcdn-proxy"

echo "==> Installing dependencies (node may already be present)"
if ! command -v node >/dev/null 2>&1; then
  if command -v apt >/dev/null 2>&1; then
    # Debian/Ubuntu
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    # Fedora / Oracle Linux / RHEL
    dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    yum install -y nodejs npm
  else
    echo "ERROR: Node not installed and no known package manager. Install Node.js manually." >&2
    exit 1
  fi
else
  echo "    node $(node -v) present"
fi

# make sure npm exists (some minimal images lack it)
if ! command -v npm >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then dnf install -y npm; fi
fi

echo "==> Creating app dir $APP_DIR"
mkdir -p "$APP_DIR"
cp -r . "$APP_DIR" 2>/dev/null || true

echo "==> Installing npm deps"
cd "$APP_DIR"
npm install --omit=dev

echo "==> Writing systemd service"
cat >/etc/systemd/system/rcdn-proxy.service <<UNIT
[Unit]
Description=RCDN Reverse Proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment="PORT=$PORT"
ExecStart=/usr/bin/env node server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

echo "==> Starting service"
systemctl daemon-reload
systemctl enable rcdn-proxy
systemctl restart rcdn-proxy
systemctl --no-pager status rcdn-proxy --lines=5

echo ""
echo "=============================================================="
echo "DONE. Proxy is running on port $PORT"
echo "  UI:       http://<SERVER_IP>:$PORT/"
echo "  YouTube:  http://<SERVER_IP>:$PORT/proxy/https://www.youtube.com/"
echo ""
echo "Logs:  journalctl -u rcdn-proxy -f"
echo "Stop:  systemctl stop rcdn-proxy"
echo "=============================================================="
