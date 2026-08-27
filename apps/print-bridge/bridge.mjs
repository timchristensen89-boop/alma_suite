#!/usr/bin/env node
// ALMA print bridge — makes an ordinary network thermal printer behave like
// one of Epson's "intelligent" (-i) models.
//
// The i-series printers POLL our API for jobs (Server Direct Print). A plain
// TM-T82III can't: it has no Server Direct Print menu. And the register can't
// talk to it directly either, because the POS is served over HTTPS and
// browsers refuse to call http://192.168.x.x from an HTTPS page.
//
// So this sits in the middle, on the venue network:
//   1. polls the SAME station URL an i-printer would (outbound HTTPS, no
//      inbound ports, nothing to open on the router),
//   2. converts the ePOS-Print XML we already generate into raw ESC/POS,
//   3. sends it to the printer on TCP 9100, which every network TM speaks,
//   4. tells the API whether it printed, so the job lands PRINTED not SENT.
//
// Zero dependencies — plain Node 18+. If a real i-series printer is ever
// bought, point it at the same URL and delete this; nothing else changes.

import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Bumped when the bridge itself changes, so the Office can tell an old
// install from a current one without someone ssh-ing in to check.
const BRIDGE_VERSION = '1.1.0';

// Preferred: name the venue and let the bridge ask the API which stations to
// serve and where they are. Change a printer's IP in Office -> Printers and
// the bridge follows within a minute; no restart, no editing a command line.
const API = (process.env.ALMA_API ?? 'https://api.almagroup.com.au').replace(/\/+$/, '');
const VENUE = process.env.ALMA_VENUE ?? '';

// Fallback: an explicit "<station-url>=<printer-ip>" list, for a venue that
// isn't in the config yet or a one-off test.
const STATIC_STATIONS = (process.env.ALMA_STATIONS ?? '')
  .split(';')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    // "<station-url>=<printer-host>[:port]"
    const [url, target] = entry.split('=');
    const [host, port] = (target ?? '').split(':');
    return { url: url?.trim(), host: host?.trim(), port: Number(port) || 9100 };
  })
  .filter((station) => station.url && station.host);

let stations = STATIC_STATIONS;

async function refreshStations() {
  if (!VENUE) return;
  try {
    const res = await fetch(`${API}/api/pos/print-stations?venue=${encodeURIComponent(VENUE)}`);
    if (!res.ok) throw new Error(`${res.status}`);
    const rows = await res.json();
    const next = rows
      .filter((row) => row.printerIp)
      .map((row) => {
        const [host, port] = String(row.printerIp).split(':');
        return { url: `${API}/api/pos/print-poll/${row.id}`, host: host.trim(), port: Number(port) || 9100, name: row.name };
      });
    const changed = JSON.stringify(next.map((s) => `${s.name}@${s.host}`)) !== JSON.stringify(stations.map((s) => `${s.name}@${s.host}`));
    stations = next;
    if (changed) {
      console.log('[bridge] stations:');
      for (const station of stations) console.log(`[bridge]   ${station.name} -> ${station.host}:${station.port}`);
    }
  } catch (err) {
    console.error(`[bridge] could not read stations: ${err.message}`);
  }
}

const INTERVAL_MS = Number(process.env.ALMA_POLL_MS ?? 5000);

// ── Heartbeat ──────────────────────────────────────────────────────────────
// Once a minute the bridge tells the API it exists — hostname and LAN IPs —
// so Office → Printers can say "bridge online at 192.168.1.42" instead of
// someone hunting the Pi across the venue wifi with arp.
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && !iface.internal && iface.family === 'IPv4')
    .map((iface) => iface.address);
}

async function heartbeat() {
  if (!VENUE) return; // static-station mode has no venue to report under
  try {
    await fetch(`${API}/api/pos/print-bridge/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ venue: VENUE, hostname: os.hostname(), lanIps: lanAddresses(), version: BRIDGE_VERSION })
    });
  } catch {
    // Offline: the next beat lands when the network is back.
  }
}

// Physical page setup, in printer dots. A docket printed hard against the
// edge is hard to read and hard to tear straight, so leave a margin both
// sides and a little air top and bottom.
// 80mm paper is ~576 printable dots (58mm is ~384) at 8 dots/mm.
const MARGIN_DOTS = Number(process.env.ALMA_MARGIN_DOTS ?? 24); // ~3mm each side
const PAPER_DOTS = Number(process.env.ALMA_PAPER_DOTS ?? 576);
const LEAD_LINES = Number(process.env.ALMA_LEAD_LINES ?? 2);
const TAIL_LINES = Number(process.env.ALMA_TAIL_LINES ?? 4);
// Line pitch in dots. The printer default (~34) leaves dockets airy and
// wastes paper; 26 is tight but still readable at arm's length.
const LINE_DOTS = Number(process.env.ALMA_LINE_DOTS ?? 26);

const HELP = `Nothing to serve.

Normal use — name the venue and the bridge reads the rest from the Office:

  ALMA_VENUE="St Alma" node bridge.mjs

Fallback — pin stations by hand ("<station-url>=<printer-ip>", ";" separated):

  ALMA_STATIONS="https://api.almagroup.com.au/api/pos/print-poll/<id>=192.168.1.16" node bridge.mjs
`;

// ── ePOS-Print XML → ESC/POS ───────────────────────────────────────────────
const ESC = '\x1b';
const GS = '\x1d';

function decodeEntities(text) {
  return text
    .replace(/&#10;/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function attr(tag, name) {
  return new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? null;
}

// Walk the <epos-print> body in document order and emit the equivalent bytes.
export function xmlToEscPos(xml) {
  const body = /<epos-print[^>]*>([\s\S]*?)<\/epos-print>/i.exec(xml)?.[1] ?? xml;
  let out = `${ESC}@`; // initialise
  // Left margin (GS L) and a matching right one by narrowing the print area
  // (GS W), then a couple of blank lines so the header isn't at the tear.
  const width = Math.max(64, PAPER_DOTS - MARGIN_DOTS * 2);
  out += `${GS}L${String.fromCharCode(MARGIN_DOTS % 256)}${String.fromCharCode(Math.floor(MARGIN_DOTS / 256))}`;
  out += `${GS}W${String.fromCharCode(width % 256)}${String.fromCharCode(Math.floor(width / 256))}`;
  out += `${ESC}3${String.fromCharCode(Math.min(Math.max(LINE_DOTS, 12), 255))}`; // line pitch
  if (LEAD_LINES > 0) out += `${ESC}d${String.fromCharCode(LEAD_LINES)}`;
  const tokens = body.match(/<[^>]+>[^<]*/g) ?? [];

  for (const token of tokens) {
    const tag = /<[^>]+>/.exec(token)?.[0] ?? '';
    const text = token.slice(tag.length);
    const name = /<\/?\s*([a-z-]+)/i.exec(tag)?.[1]?.toLowerCase();

    if (name === 'text') {
      const align = attr(tag, 'align');
      if (align) out += `${ESC}a${align === 'center' ? '\x01' : align === 'right' ? '\x02' : '\x00'}`;
      const width = Number(attr(tag, 'width') ?? 0);
      const height = Number(attr(tag, 'height') ?? 0);
      if (width || height) {
        const w = Math.min(Math.max(width || 1, 1), 8) - 1;
        const h = Math.min(Math.max(height || 1, 1), 8) - 1;
        out += `${GS}!${String.fromCharCode((w << 4) | h)}`;
      }
      const em = attr(tag, 'em');
      if (em !== null) out += `${ESC}E${em === 'true' ? '\x01' : '\x00'}`;
      const reverse = attr(tag, 'reverse');
      if (reverse !== null) out += `${GS}B${reverse === 'true' ? '\x01' : '\x00'}`;
      const underline = attr(tag, 'ul');
      if (underline !== null) out += `${ESC}-${underline === 'true' ? '\x01' : '\x00'}`;
      if (text.trim()) out += decodeEntities(text);
      continue;
    }
    if (name === 'feed') {
      const lines = Number(attr(tag, 'line') ?? 1);
      out += `${ESC}d${String.fromCharCode(Math.min(Math.max(lines, 1), 255))}`;
      continue;
    }
    if (name === 'cut') {
      out += `${GS}VA\x00`; // feed then partial cut
      continue;
    }
    if (name === 'pulse') {
      out += `${ESC}p\x00\x19\xfa`; // kick the cash drawer
      continue;
    }
    if (text.trim()) out += decodeEntities(text);
  }
  // Leave paper clear of the head. The docket's own <cut> fires before this,
  // so only add a cut when it didn't ask for one.
  if (!/\<cut/i.test(body)) out += `${ESC}d${String.fromCharCode(TAIL_LINES)}${GS}VA\x00`;
  return Buffer.from(out, 'binary');
}

// ── Printer ────────────────────────────────────────────────────────────────
function sendToPrinter(host, port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const fail = (err) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(8000, () => fail(new Error('printer timed out')));
    socket.on('error', fail);
    socket.on('connect', () => {
      socket.write(bytes, () => {
        // Give the printer a beat to take the buffer before hanging up.
        setTimeout(() => {
          socket.end();
          resolve();
        }, 250);
      });
    });
  });
}

// ── API ────────────────────────────────────────────────────────────────────
async function post(url, fields) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString()
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

// Is the printer actually there? Checked BEFORE collecting a job, because
// collecting one we can't print loses it: the API marks it SENT, and a
// failure marks it FAILED — neither is ever retried. A printer that's off
// should simply hold its dockets until someone switches it on.
function printerReachable(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2500, () => done(false));
    socket.on('error', () => done(false));
    socket.on('connect', () => done(true));
  });
}

async function pollStation(station) {
  if (!(await printerReachable(station.host, station.port))) {
    if (!station.warned) {
      console.log(`[bridge] ${station.name ?? station.host} is offline — holding its dockets`);
      station.warned = true;
    }
    return false;
  }
  if (station.warned) {
    console.log(`[bridge] ${station.name ?? station.host} is back`);
    station.warned = false;
  }
  const xml = await post(station.url, { ConnectionType: 'GetRequest' });
  if (!xml || !xml.trim()) return false; // nothing waiting

  const jobId = /<printjobid>([^<]+)<\/printjobid>/i.exec(xml)?.[1] ?? '';
  let ok = true;
  // NB: this function reports whether a JOB WAS COLLECTED, not whether it
  // printed. A printer that's off must not stall the queue for the others.
  try {
    await sendToPrinter(station.host, station.port, xmlToEscPos(xml));
    console.log(`[bridge] printed ${jobId || '(no id)'} at ${station.host}`);
  } catch (err) {
    ok = false;
    console.error(`[bridge] FAILED ${jobId || '(no id)'} -> ${station.host}: ${err.message}`);
  }
  // Tell the API either way, so a failure shows up as FAILED rather than
  // sitting on SENT looking like it worked.
  if (jobId) {
    await post(station.url, {
      ConnectionType: 'SetResponse',
      ResponseFile: `<PrintResponseInfo><printjobid>${jobId}</printjobid><Response success="${ok}" code="${
        ok ? 'ok' : 'error'
      }"/></PrintResponseInfo>`
    }).catch(() => undefined);
  }
  return true;
}

async function tick() {
  for (const station of stations) {
    try {
      // Drain rather than one-per-tick, so a burst of courses doesn't trickle.
      for (let i = 0; i < 10; i += 1) {
        const had = await pollStation(station);
        if (!had) break;
      }
    } catch (err) {
      console.error(`[bridge] ${station.url}: ${err.message}`);
    }
  }
}

// Only run the loop when executed directly — importing this file (to test the
// converter, say) must not start polling. fileURLToPath, not string compare:
// this repo's path contains a space, which import.meta.url percent-encodes.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!VENUE && STATIC_STATIONS.length === 0) {
    console.error(HELP);
    process.exit(1);
  }
  console.log(`[bridge] ALMA print bridge running${VENUE ? ` for ${VENUE}` : ''}`);
  await refreshStations();
  for (const station of stations) console.log(`[bridge]   ${station.name ?? station.host} -> ${station.host}:${station.port}`);
  await heartbeat();
  await tick();
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  // Pick up printer changes made in the Office without a restart, and keep
  // announcing this machine so the Office knows the bridge is alive.
  if (VENUE) {
    setInterval(() => void refreshStations(), 60_000);
    setInterval(() => void heartbeat(), 60_000);
  }
}
