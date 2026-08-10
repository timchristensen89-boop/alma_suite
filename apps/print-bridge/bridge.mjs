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
import { fileURLToPath } from 'node:url';

const STATIONS = (process.env.ALMA_STATIONS ?? '')
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

const INTERVAL_MS = Number(process.env.ALMA_POLL_MS ?? 5000);

const HELP = `No stations configured.

Set ALMA_STATIONS to one or more "<station-url>=<printer-ip>" pairs, separated by ";".

  ALMA_STATIONS="https://api.almagroup.com.au/api/pos/print-poll/stalma-kitchen=192.168.1.16" \\
    node bridge.mjs
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
      if (text) out += decodeEntities(text);
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
    if (text) out += decodeEntities(text);
  }
  // Leave paper clear of the head, and cut if the docket didn't say to.
  if (!/\<cut/i.test(body)) out += `${ESC}d\x03${GS}VA\x00`;
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

async function pollStation(station) {
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
  for (const station of STATIONS) {
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
  if (STATIONS.length === 0) {
    console.error(HELP);
    process.exit(1);
  }
  console.log('[bridge] ALMA print bridge running');
  for (const station of STATIONS) console.log(`[bridge]   ${station.host}:${station.port}  <-  ${station.url}`);
  await tick();
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
}
