#!/usr/bin/env bash
# Ycamera Hub 一键部署(Ubuntu/Debian,1C1.5G 够用)
# 用法:
#   1. 本地:rsync/scp 整个 server 目录到 VPS 的 /tmp/ycamera-hub
#   2. VPS: sudo bash setup-server.sh
#
# 环境变量:
#   ADMIN_PASSWORD  管理员口令(必改)
#   DEVICE_CODE     摄影师团队口令(必改)
#   PORT            默认 8787
set -euo pipefail

APP=/opt/ycamera-hub
DATA=/srv/ycamera
PORT="${PORT:-8787}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme-admin}"
DEVICE_CODE="${DEVICE_CODE:-changeme-team}"
SRC="${SRC:-/tmp/ycamera-hub}"

echo "[1/6] 安装 Node.js 20"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2-3)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "[2/6] 建用户与目录"
id -u ycamera >/dev/null 2>&1 || useradd -r -m -d /opt/ycamera-home -s /usr/sbin/nologin ycamera
mkdir -p "$APP" "$DATA"/{files,thumbs,tmp}
[ -d "$SRC" ] || { echo "源码目录 $SRC 不存在"; exit 1; }
cp -r "$SRC"/. "$APP"/
chown -R ycamera:ycamera "$APP" "$DATA"
chmod 750 "$DATA"

echo "[3/6] 安装依赖"
cd "$APP"
sudo -u ycamera npm install --omit=dev --no-audit --no-fund

echo "[4/6] systemd 服务"
cat > /etc/systemd/system/ycamera-hub.service <<EOF
[Unit]
Description=Ycamera Hub
After=network.target

[Service]
Type=simple
User=ycamera
WorkingDirectory=$APP
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA
Environment=ADMIN_PASSWORD=$ADMIN_PASSWORD
Environment=DEVICE_CODE=$DEVICE_CODE
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $APP/server.js
Restart=always
RestartSec=5
# 小机器省内存
MemoryMax=600M

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ycamera-hub
sleep 2
systemctl --no-pager --lines=5 status ycamera-hub || true

echo "[5/6] 防火墙"
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp || true
  ufw allow ${PORT}/tcp || true
  ufw allow 80/tcp || true
  ufw allow 443/tcp || true
fi

echo "[6/6] 完成"
IP=$(curl -s -4 ifconfig.me || echo "你的服务器IP")
cat <<TXT

  摄影师上传:  http://${IP}:${PORT}/
  管理员后台:  http://${IP}:${PORT}/admin
  团队口令:    ${DEVICE_CODE}
  管理员口令:  ${ADMIN_PASSWORD}
  数据目录:    ${DATA}

  建议下一步:配 HTTPS(手机浏览器传大文件更稳)
    apt-get install -y caddy
    cat > /etc/caddy/Caddyfile <<'EOF'
    :80 {
      reverse_proxy 127.0.0.1:${PORT}
      request_body { max_size 4GB }
    }
    EOF
    systemctl reload caddy

TXT
