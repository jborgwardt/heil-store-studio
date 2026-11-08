#!/bin/sh
set -eu
umask 077
mkdir -p /data/.config/feather /data/Monero/wallets
chown -R 1000:1000 /data
exec runuser -u feather -- /usr/local/bin/feather-session
