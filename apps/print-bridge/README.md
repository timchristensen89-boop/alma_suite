# ALMA print bridge

Makes an ordinary network thermal printer behave like one of Epson's
"intelligent" (`-i`) models.

## Why

The i-series printers **poll** our API for jobs (Epson Server Direct Print).
A plain **TM-T82III** has no Server Direct Print menu, so it can't. And the
register can't reach it directly either: the POS is served over HTTPS and
browsers refuse to call `http://192.168.x.x` from an HTTPS page.

This sits between them, on the venue network:

1. polls the **same station URL** an i-printer would — outbound HTTPS only,
   so there is nothing to open on the router;
2. converts the ePOS-Print XML the API already generates into raw **ESC/POS**;
3. sends it to the printer on **TCP 9100**, which every network TM speaks;
4. reports back, so a job lands `PRINTED` — or `FAILED` if the printer is off,
   instead of sitting on `SENT` looking like it worked.

One bridge drives **any number of printers**. If an i-series printer is bought
later, point it at the same URL and stop the bridge — nothing else changes.

## Running it

Needs Node 18+ on any always-on machine on the venue LAN (a Mac, a mini PC, a
Raspberry Pi). No dependencies, no install.

```bash
ALMA_STATIONS="\
https://api.almagroup.com.au/api/pos/print-poll/<profileId>=<printer-ip>;\
https://api.almagroup.com.au/api/pos/print-poll/<profileId>=<printer-ip>" \
  node bridge.mjs
```

Separate stations with `;`. Add `:port` after the IP if it isn't 9100.
`ALMA_POLL_MS` changes the interval (default 5000).

Station ids are shown in POS → Office → Printers, and a station only queues
jobs if it has a printer IP set there.

## Putting it on a Pi (the permanent home)

Copy this folder to the Pi and run:

```bash
sudo ./install-pi.sh "Alma Avalon"     # or "St Alma"
```

That installs Node if needed, drops the bridge in `/opt/alma-print-bridge`,
and registers a systemd service that starts on boot and restarts if it dies.

```bash
journalctl -u alma-print-bridge -f     # watch it
sudo systemctl restart alma-print-bridge
```

**One bridge serves one venue** — each venue needs its own, on its own
network, because the printers are only reachable from inside.

**Any Pi works, including a very old one.** Pi 2 and newer take Node from
NodeSource. Pi 1 and Pi Zero are ARMv6, which Node stopped shipping official
builds for — the installer pulls the current LTS from the nodejs
unofficial-builds project instead. The bridge only polls and writes to a
socket, so a 700MHz single core is ample.

A till that needs someone to remember to launch a script is a till that stops
printing after the first power cut — hence a service, not a login item.

## Checking it

`PosPrintJob.status` tells you where a docket got to:

- `QUEUED` — we have it, nothing has collected it (bridge down, or the station
  has no printer IP)
- `SENT` — collected, no result reported yet
- `PRINTED` / `FAILED` — the bridge reported back
