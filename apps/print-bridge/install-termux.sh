#!/data/data/com.termux/files/usr/bin/bash
# Install the ALMA print bridge on an Android tablet, via Termux.
#
# A spare Android tablet is a perfectly good bridge: it sits on the venue
# wifi, runs Node, and can open a socket to the printer. An iPad cannot —
# iOS won't run Node or keep a background process alive, so this is Android
# only.
#
# Run IN Termux (not root, Termux has no sudo):
#   ./install-termux.sh "Alma Avalon"
#
# Prerequisites, both from F-Droid (the Play Store builds are too old):
#   - Termux
#   - Termux:Boot        <- without this it will not restart after a power cut
#
# BATTERY: a tablet left plugged in at 100% for months is how you get a
# swollen battery. Check it still sits flat on a table before committing it
# to a cupboard behind a printer.

set -euo pipefail

VENUE="${1:-}"
if [ -z "$VENUE" ]; then
  echo 'Usage: ./install-termux.sh "Alma Avalon"   (or "St Alma")' >&2
  exit 1
fi

echo "== ALMA print bridge (Termux) =="
echo "   venue : $VENUE"

echo "-- packages"
pkg update -y >/dev/null 2>&1 || true
pkg install -y nodejs-lts termux-api >/dev/null 2>&1 || pkg install -y nodejs termux-api
echo "   node  : $(node -v)"

INSTALL_DIR="$HOME/alma-print-bridge"
mkdir -p "$INSTALL_DIR"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/bridge.mjs" ]; then
  cp "$SCRIPT_DIR/bridge.mjs" "$INSTALL_DIR/bridge.mjs"
else
  echo "bridge.mjs must sit next to this script." >&2
  exit 1
fi

# Android will happily suspend the process the moment the screen goes off, so
# hold a wake lock for as long as the bridge runs.
cat > "$INSTALL_DIR/run.sh" <<RUNNER
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
export ALMA_VENUE="$VENUE"
# Restart on crash — no systemd here, so the loop is the supervisor.
while true; do
  node "$INSTALL_DIR/bridge.mjs" >> "$INSTALL_DIR/bridge.log" 2>&1
  echo "[\$(date)] bridge exited, restarting in 5s" >> "$INSTALL_DIR/bridge.log"
  sleep 5
done
RUNNER
chmod +x "$INSTALL_DIR/run.sh"

# Termux:Boot runs anything in this folder when the tablet powers up.
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/alma-print-bridge" <<BOOT
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
$INSTALL_DIR/run.sh
BOOT
chmod +x "$HOME/.termux/boot/alma-print-bridge"

cat <<DONE

Installed at $INSTALL_DIR

  start now : $INSTALL_DIR/run.sh &
  watch it  : tail -f $INSTALL_DIR/bridge.log

STILL TO DO ON THE TABLET, or it will stop overnight:
  1. Open Termux:Boot once (it does nothing visible — it just registers).
  2. Android settings -> Apps -> Termux -> Battery -> Unrestricted
     (also do this for Termux:Boot).
  3. Keep it on mains, and set the screen to never sleep if the option exists.

Printers come from POS -> Office -> Printers and are re-read every minute,
so changing an IP there is enough.
DONE
