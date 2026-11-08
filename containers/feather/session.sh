#!/bin/sh
set -eu
umask 077
python3 - <<'PY'
import json,os,pathlib,urllib.parse
p=pathlib.Path('/data/.config/feather/settings.json')
if not p.exists():
    user=urllib.parse.quote(os.environ.get('MONERO_USER',''),safe='')
    password=urllib.parse.quote(os.environ.get('MONERO_PASSWORD',''),safe='')
    host=os.environ.get('MONERO_HOST','monero_monerod_1')
    port=os.environ.get('MONERO_PORT','18081')
    auth=f'{user}:{password}@' if user and password else ''
    node=f'http://{auth}{host}:{port}'
    p.write_text(json.dumps({'firstRun':False,'nodeSource':1,'nodes':{'0':{'custom':[node],'ws':[]}},'walletDirectory':'/data/Monero/wallets'}))
PY
Xvfb :0 -screen 0 1280x800x24 -nolisten tcp &
for i in $(seq 1 30); do xdpyinfo >/dev/null 2>&1 && break; sleep 1; done
openbox >/dev/null 2>&1 &
x11vnc -display :0 -localhost -rfbport 5900 -forever -shared -nopw -quiet >/dev/null 2>&1 &
websockify --web=/usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
exec /opt/feather/feather
