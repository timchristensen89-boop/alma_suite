#!/usr/bin/env bash
# Install the ALMA print bridge on a Mac as a LaunchDaemon: starts at boot,
# before anyone logs in, and gets restarted if it ever dies.
#
# Run ON the Mac, from the print-bridge folder:
#   sudo ./install-mac.sh "St Alma"          (or "Alma Avalon")
#
# A LaunchDaemon rather than a LaunchAgent on purpose. An Agent only runs
# while someone is logged in, so the first restart with the login window up
# would stop every docket at the venue with no visible cause.
#
# THE MAC MUST BE AT THE VENUE, on the venue's wifi. The bridge reaches the
# printers over the LAN — it cannot print to Freshwater from someone's
# kitchen table, and each venue needs its own.

set -euo pipefail

VENUE="${1:-}"
if [ -z "$VENUE" ]; then
  echo 'Usage: sudo ./install-mac.sh "St Alma"   (or "Alma Avalon")' >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

LABEL="com.almagroup.printbridge"
INSTALL_DIR="/usr/local/alma-print-bridge"
PLIST="/Library/LaunchDaemons/$LABEL.plist"
LOG_DIR="/usr/local/var/log"

echo "== ALMA print bridge (macOS) =="
echo "   venue : $VENUE"

# ── Node ───────────────────────────────────────────────────────────────────
# fetch() is built in from 18, and the bridge relies on it.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -x /opt/homebrew/bin/node ]; then NODE_BIN=/opt/homebrew/bin/node; fi
if [ -z "$NODE_BIN" ] && [ -x /usr/local/bin/node ]; then NODE_BIN=/usr/local/bin/node; fi

if [ -z "$NODE_BIN" ]; then
  cat >&2 <<'NONODE'
Node isn't installed on this Mac.

  with Homebrew : brew install node
  without       : download the macOS installer from https://nodejs.org

Then run this script again.
NONODE
  exit 1
fi

MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$MAJOR" -lt 18 ]; then
  echo "   node  : $("$NODE_BIN" -v) — too old, need 18 or newer." >&2
  exit 1
fi
echo "   node  : $("$NODE_BIN" -v)  ($NODE_BIN)"

# ── Files ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ ! -f "$SCRIPT_DIR/bridge.mjs" ]; then
  echo "bridge.mjs must sit next to this script." >&2
  exit 1
fi
mkdir -p "$INSTALL_DIR" "$LOG_DIR"
cp "$SCRIPT_DIR/bridge.mjs" "$INSTALL_DIR/bridge.mjs"
chmod 644 "$INSTALL_DIR/bridge.mjs"

# ── Daemon ─────────────────────────────────────────────────────────────────
cat > "$PLIST" <<PLISTXML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$INSTALL_DIR/bridge.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ALMA_VENUE</key>
    <string>$VENUE</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <!-- The venue wifi comes back before the printers do; just keep trying. -->
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/alma-print-bridge.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/alma-print-bridge.log</string>
</dict>
</plist>
PLISTXML
chmod 644 "$PLIST"
chown root:wheel "$PLIST"

launchctl bootout system "$PLIST" 2>/dev/null || true
launchctl bootstrap system "$PLIST"
launchctl enable "system/$LABEL"
sleep 3

if launchctl print "system/$LABEL" >/dev/null 2>&1; then
  echo "   status: running"
else
  echo "   status: NOT running — check $LOG_DIR/alma-print-bridge.log" >&2
fi

cat <<DONE

Installed. Starts at boot, restarts if it stops.

  watch it  : tail -f $LOG_DIR/alma-print-bridge.log
  restart   : sudo launchctl kickstart -k system/$LABEL
  remove    : sudo launchctl bootout system $PLIST && sudo rm $PLIST

Printers come from POS -> Office -> Printers and are re-read every minute, so
changing a printer's IP there is enough — no need to come back here.

TWO THINGS THAT WILL STOP IT PRINTING, both worth deciding now:

  1. SLEEP. A sleeping Mac prints nothing. If this machine lives at the venue
     on mains power, allow it to stay awake while plugged in:

         sudo pmset -c sleep 0 disablesleep 1

     That is charger-only, so battery life is unaffected. Skip it if the Mac
     goes home at night — but then expect no dockets while it's away.

  2. IT LEAVES THE BUILDING. The bridge talks to the printers over the venue
     LAN. Off-site, or on a phone hotspot, dockets queue and print when it
     next gets back on the venue wifi. Nothing is lost, but nothing prints
     meanwhile — so a laptop someone takes home is a part-time print server.
DONE
