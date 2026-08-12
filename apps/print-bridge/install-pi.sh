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

# Every Pi works, including the very old ones — the arch only decides where
# Node comes from.
case "$ARCH" in
  # Pi 1 / Pi Zero. Node stopped shipping official ARMv6 builds, but the
  # nodejs unofficial-builds project still publishes them for current LTS —
  # so an old Pi works fine. The bridge only polls and writes to a socket;
  # a 700MHz single core is ample.
  armv6l) echo "   note  : ARMv6 — using nodejs unofficial-builds" ;;
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
  if [ "$ARCH" = "armv6l" ]; then
    # NodeSource has no ARMv6 packages; take the tarball instead.
    echo "-- installing Node (unofficial ARMv6 build)"
    VER="$(curl -fsSL https://unofficial-builds.nodejs.org/download/release/index.json \
      | python3 -c "import json,sys;rows=json.load(sys.stdin);print(next(r['version'] for r in rows if 'linux-armv6l' in r['files'] and r.get('lts')))")"
    echo "   version: $VER"
    # Disk-backed, not /tmp: on a 512MB Pi /tmp is a ~214MB tmpfs and
    # extracting Node fills it, with tar failing mid-write.
    TMP="$(mktemp -d -p /var/tmp)"
    curl -fsSL "https://unofficial-builds.nodejs.org/download/release/$VER/node-$VER-linux-armv6l.tar.gz" \
      -o "$TMP/node.tar.gz"
    tar -xzf "$TMP/node.tar.gz" -C "$TMP"
    cp -R "$TMP/node-$VER-linux-armv6l"/{bin,include,lib,share} /usr/local/
    rm -rf "$TMP"
    hash -r
  else
    echo "-- installing Node 20"
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
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
# The venue's wifi comes back before the printers do; just keep trying.
# This is a [Unit] directive — in [Service] systemd ignores it silently.
StartLimitIntervalSec=0
Documentation=https://alma-pos.web.app
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment="ALMA_VENUE=$VENUE"
# Uncomment to tune the paper: margins in dots (8/mm), line pitch, feed.
#Environment=ALMA_MARGIN_DOTS=24
#Environment=ALMA_LINE_DOTS=26
#Environment=ALMA_LEAD_LINES=2
#Environment=ALMA_TAIL_LINES=4
ExecStart=$(command -v node) $INSTALL_DIR/bridge.mjs
Restart=always
RestartSec=5
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
