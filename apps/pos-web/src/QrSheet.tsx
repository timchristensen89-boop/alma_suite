import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, messageForError } from './api';

// ── Staff QR sheet ──────────────────────────────────────────────────────────
// alma-pos.web.app/#qr (register session required): every table's ordering
// QR for a venue, print-ready — cut out and drop into the table stands.

const VENUES = ['Alma Avalon', 'St Alma', 'Functions / Pop-up'];

type TableToken = { label: string; token: string; url: string };

export function QrSheet() {
  const [venue, setVenue] = useState(VENUES[0]!);
  const [tables, setTables] = useState<Array<TableToken & { qr: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTables([]);
    void api<TableToken[]>(`/api/pos/qr-tables?venue=${encodeURIComponent(venue)}`)
      .then(async (rows) => {
        const withQr = await Promise.all(
          rows.map(async (row) => ({ ...row, qr: await QRCode.toDataURL(row.url, { width: 240, margin: 1 }) }))
        );
        setTables(withQr);
        setError(null);
      })
      .catch((err) => setError(messageForError(err, 'Could not load the tables.')));
  }, [venue]);

  return (
    <div className="qrs-shell">
      <header className="qrs-header">
        <strong>Table ordering QRs</strong>
        <select value={venue} onChange={(event) => setVenue(event.currentTarget.value)}>
          {VENUES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => window.print()}>
          Print
        </button>
      </header>
      {error ? <div className="qr-error">{error}</div> : null}
      {tables.length === 0 && !error ? <p className="qr-muted" style={{ padding: 16 }}>Loading…</p> : null}
      <div className="qrs-grid" id="qr-print">
        {tables.map((table) => (
          <div key={table.label} className="qrs-card">
            <strong>ALMA · {venue}</strong>
            <img src={table.qr} alt={`Table ${table.label} ordering QR`} />
            <h3>Table {table.label}</h3>
            <small>Scan to order</small>
          </div>
        ))}
      </div>
    </div>
  );
}
