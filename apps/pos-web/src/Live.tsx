import { useEffect, useState } from 'react';
import { api, messageForError } from './api';

// ── ALMA Live — the owner's phone view ──────────────────────────────────────
// alma-pos.web.app/#live: today-so-far for every venue, refreshed every 15s.
// Sales, covers, tips, open tables and what's owing, top items, per-server
// takings and the hourly shape of the day. Training sales never appear.

type LiveVenue = {
  venue: string;
  totalCents: number;
  tipCents: number;
  covers: number;
  orderCount: number;
  avgPerCoverCents: number | null;
  openCount: number;
  openOwingCents: number;
  topItems: Array<{ name: string; quantity: number; totalCents: number }>;
  servers: Array<{ name: string; totalCents: number; orders: number }>;
  hourly: Array<{ hour: number; cents: number }>;
};

type Board = { serviceDate: string; generatedAt: string; venues: LiveVenue[] };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function Live() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wrapped because a till can be running inside a webview with site data
    // switched off, where merely touching localStorage throws — and an
    // unhandled throw here takes the whole board down over a colour scheme.
    let dark = false;
    try {
      dark = localStorage.getItem('alma.pos.theme') === 'dark';
    } catch {
      /* no stored preference reachable — the light board is the default */
    }
    document.body.classList.toggle('pos-dark', dark);
  }, []);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api<Board>('/api/pos/live')
        .then((next) => {
          if (!alive) return;
          setBoard(next);
          setError(null);
        })
        .catch((err) => {
          if (alive) setError(messageForError(err, 'Could not reach the register.'));
        });
    void refresh();
    const poll = setInterval(() => void refresh(), 15000);
    return () => {
      alive = false;
      clearInterval(poll);
    };
  }, []);

  const grandTotal = (board?.venues ?? []).reduce((sum, venue) => sum + venue.totalCents, 0);
  const grandCovers = (board?.venues ?? []).reduce((sum, venue) => sum + venue.covers, 0);

  // Opened from the register's app switcher, Live gets its own window so the
  // two run side by side. In that case the way back is to close this one —
  // the register is still there behind it, with its open bill intact.
  // Reached any other way (a bookmark, a shared link, a second device) there
  // is nothing behind, so the button navigates instead. The label says which
  // of the two is about to happen rather than guessing on the operator's
  // behalf: they were stuck here because there was no button at all.
  const ownWindow = typeof window !== 'undefined' && Boolean(window.opener) && !window.opener?.closed;
  const backToRegister = () => {
    if (ownWindow) {
      window.close();
      return;
    }
    // main.tsx picks the surface at load time, so dropping the hash has to
    // reload rather than just change it.
    window.location.href = `${window.location.origin}${window.location.pathname}`;
  };

  return (
    <div className="live-shell">
      <header className="live-header">
        {/* First, on the left, where a back control belongs — not tucked after
            the total where a thumb never looks for it. */}
        <button
          type="button"
          className="live-back"
          onClick={backToRegister}
          title={ownWindow ? 'Close this window — the register is behind it' : 'Back to the register'}
        >
          {ownWindow ? '✕ Close' : '← Register'}
        </button>
        <strong>ALMA Live</strong>
        <span className="live-date">{board?.serviceDate ?? '—'}</span>
        <span style={{ flex: 1 }} />
        <span className="live-grand">
          {money(grandTotal)}
          {grandCovers > 0 ? <small> · {grandCovers} covers</small> : null}
        </span>
      </header>

      {error ? <div className="live-error">{error}</div> : null}
      {!board && !error ? <p className="live-empty">Loading…</p> : null}
      {board && board.venues.length === 0 ? <p className="live-empty">No sales yet today.</p> : null}

      {(board?.venues ?? []).map((venue) => {
        const peak = Math.max(1, ...venue.hourly.map((slot) => slot.cents));
        return (
          <section key={venue.venue} className="live-venue">
            <div className="live-venue-head">
              <h2>{venue.venue}</h2>
              <strong className="live-total">{money(venue.totalCents)}</strong>
            </div>
            <div className="live-stats">
              <span>
                <b>{venue.orderCount}</b> bills
              </span>
              <span>
                <b>{venue.covers}</b> covers
              </span>
              {venue.avgPerCoverCents !== null ? (
                <span>
                  <b>{money(venue.avgPerCoverCents)}</b> / cover
                </span>
              ) : null}
              <span>
                <b>{money(venue.tipCents)}</b> tips
              </span>
              {venue.openCount > 0 ? (
                <span className="live-open">
                  <b>{venue.openCount}</b> open · {money(venue.openOwingCents)} owing
                </span>
              ) : null}
            </div>

            {venue.hourly.length > 0 ? (
              <div className="live-hours">
                {venue.hourly.map((slot) => (
                  <div key={slot.hour} className="live-hour">
                    <div className="live-hour-bar" style={{ height: `${Math.max(8, Math.round((slot.cents / peak) * 100))}%` }} />
                    <small>{slot.hour}</small>
                  </div>
                ))}
              </div>
            ) : null}

            {venue.topItems.length > 0 ? (
              <div className="live-items">
                {venue.topItems.map((item) => (
                  <div key={item.name} className="live-item">
                    <span>
                      {item.quantity}× {item.name}
                    </span>
                    <b>{money(item.totalCents)}</b>
                  </div>
                ))}
              </div>
            ) : null}

            {venue.servers.length > 0 ? (
              <div className="live-servers">
                {venue.servers.map((server) => (
                  <span key={server.name} className="live-server">
                    {server.name} · {money(server.totalCents)}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
