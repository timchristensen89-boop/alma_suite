#!/usr/bin/env bash
# Install the ALMA print bridge on a Raspberry Pi (or any Debian box) as a
# service that starts on boot and restarts if it dies.
#
# Run ON the Pi:
#   curl -fsSL <this file> | sudo bash -s -- "Alma Avalon"
# or, having copied the folder across:
#   sudo ./install-pi.sh "Alma Avalon"
#
# A till that needs someone to remember to start a script is a till that
# stops printing after the first power cut, so this is deliberately a
# service and not a login item.

set -euo pipefail

VENUE="${1:-}"
if [ -z "$VENUE" ]; then
  echo "Usage: sudo ./install-pi.sh \"Alma Avalon\"   (or \"St Alma\")" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

ARCH="$(uname -m)"
echo "== ALMA print bridge =="
echo "   venue : $VENUE"
echo "   arch  : $ARCH"

# An "old Pi" is the one real risk here. Pi 1 and Pi Zero are ARMv6, which
# Node dropped official builds for years ago — better to say so plainly than
# to fail three steps later with something cryptic.
case "$ARCH" in
  armv6l)
    cat >&2 <<'MSG'

This is an ARMv6 Pi (Pi 1 / Pi Zero). Node.js has no official builds for it
any more, so the bridge cannot run here without an unofficial toolchain.

Options that do work:
  - a Pi 2 or newer (ARMv7/ARM64), or
  - any always-on mini PC / spare laptop on the venue network.

MSG
    exit 1
    ;;
  armv7l|aarch64|arm64|x86_64) ;;
  *) echo "   (unrecognised arch — continuing, but node may not install)" ;;
esac

# ── Node ───────────────────────────────────────────────────────────────────
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  # fetch() is built in from 18; the bridge relies on it.
  if [ "$MAJOR" -ge 18 ]; then
    echo "   node  : $(node -v) (ok)"
    NEED_NODE=0
  else
    echo "   node  : $(node -v) — too old, need 18+"
  fi
fi

if [ "$NEED_NODE" -eq 1 ]; then
  echo "-- installing Node 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "   node  : $(node -v)"
fi

# ── Files ──────────────────────────────────────────────────────────────────
INSTALL_DIR=/opt/alma-print-bridge
mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/bridge.mjs" ]; then
  cp "$SCRIPT_DIR/bridge.mjs" "$INSTALL_DIR/bridge.mjs"
else
  echo "-- fetching bridge.mjs"
  curl -fsSL "https://raw.githubusercontent.com/alma/pos/main/apps/print-bridge/bridge.mjs" \
    -o "$INSTALL_DIR/bridge.mjs" 2>/dev/null || {
      echo "bridge.mjs not found next to this script — copy the print-bridge folder across first." >&2
      exit 1
    }
fi
chmod 644 "$INSTALL_DIR/bridge.mjs"

# ── Service ────────────────────────────────────────────────────────────────
cat > /etc/systemd/system/alma-print-bridge.service <<SERVICE
[Unit]
Description=ALMA print bridge ($VENUE)
Documentation=https://alma-pos.web.app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=ALMA_VENUE=$VENUE
# Uncomment to tune the paper: margins in dots (8/mm), line pitch, feed.
#Environment=ALMA_MARGIN_DOTS=24
#Environment=ALMA_LINE_DOTS=26
#Environment=ALMA_LEAD_LINES=2
#Environment=ALMA_TAIL_LINES=4
ExecStart=/usr/bin/node $INSTALL_DIR/bridge.mjs
Restart=always
RestartSec=5
# The venue's wifi comes back before the printers do; just keep trying.
StartLimitIntervalSec=0
StandardOutput=journal
StandardError=journal
User=root

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable alma-print-bridge
systemctl restart alma-print-bridge
sleep 3

echo
systemctl --no-pager --lines=12 status alma-print-bridge || true
cat <<DONE

Installed. It starts on boot and restarts if it stops.

  watch it     : journalctl -u alma-print-bridge -f
  restart      : sudo systemctl restart alma-print-bridge
  change venue : sudo systemctl edit --full alma-print-bridge

Printers are read from POS -> Office -> Printers every minute, so changing a
printer's IP there is enough — no need to come back here.
DONE
