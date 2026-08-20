import { useCallback, useEffect, useState } from 'react';
import { api, messageForError } from './api';

// ── ALMA KDS — kitchen display ──────────────────────────────────────────────
// Open alma-pos.web.app/#kds on any kitchen tablet (device cookie session).
// Live ticket rail per station: age timers colour green→amber→red, tap to
// bump, recent-bumped rail recalls. Polls every 5s.

type TicketLine = { name: string; quantity: number; course: string | null; seat?: number | null; modifiers?: Array<{ name: string }>; notes?: string | null };
type Ticket = {
  id: string;
  station: string;
  orderNumber: number;
  tableLabel: string | null;
  covers: number | null;
  openedByName: string | null;
  lines: TicketLine[];
  firedAt: string;
  bumpedAt: string | null;
};
type Board = { tickets: Ticket[]; recent: Ticket[]; allDay: Array<{ name: string; quantity: number }> };

const VENUES = ['Alma Avalon', 'St Alma', 'Functions / Pop-up'];

function ageSeconds(iso: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
}

function ageLabel(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Which colour slot a course heading gets.
 *
 * The pass reads a ticket from a metre away and needs to know at a glance
 * whether the next thing down is Course 1 or Course 3. Every heading was the
 * same muted grey, so that took reading the words.
 *
 * Deliberately NOT green, amber or red: those three already mean something
 * else on this screen — how late the ticket is — and a course that borrowed
 * one would read as urgency. The register seeds NOW plus Course 1-6
 * (pos.service listCourses); anything else a venue types falls through to a
 * neutral slot rather than colliding with a numbered one.
 */
function courseTone(course: string): string {
  const name = course.trim().toLowerCase();
  if (name === 'now') return 'now';
  const numbered = /^course\s+([1-6])$/.exec(name);
  return numbered ? `c${numbered[1]}` : 'other';
}

export function Kds() {
  const [venue, setVenue] = useState(() => localStorage.getItem('alma.kds.venue') ?? VENUES[0]!);
  const [station, setStation] = useState(() => localStorage.getItem('alma.kds.station') ?? 'Kitchen');
  const [stations, setStations] = useState<string[]>(['Kitchen', 'Bar']);
  const [board, setBoard] = useState<Board | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBoard(await api<Board>(`/api/pos/kds?venue=${encodeURIComponent(venue)}&station=${encodeURIComponent(station)}`));
      setError(null);
    } catch (err) {
      setError(messageForError(err, 'Could not reach the register.'));
    }
  }, [venue, station]);

  useEffect(() => {
    localStorage.setItem('alma.kds.venue', venue);
    localStorage.setItem('alma.kds.station', station);
  }, [venue, station]);

  useEffect(() => {
    void api<Array<{ name: string }>>('/api/pos/printer-profiles')
      .then((profiles) => setStations(profiles.map((profile) => profile.name)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 5000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [refresh]);

  async function bump(ticket: Ticket, recall = false) {
    setBoard((current) =>
      current
        ? {
            ...current,
            tickets: recall ? current.tickets : current.tickets.filter((candidate) => candidate.id !== ticket.id),
            recent: recall ? current.recent.filter((candidate) => candidate.id !== ticket.id) : current.recent
          }
        : current
    );
    try {
      await api(`/api/pos/kds/${ticket.id}/${recall ? 'recall' : 'bump'}`, { method: 'POST' });
    } catch (err) {
      setError(messageForError(err, 'Bump failed.'));
    }
    void refresh();
  }

  return (
    <div className="kds-shell">
      <header className="kds-header">
        <strong>ALMA KDS</strong>
        <select value={venue} onChange={(event) => setVenue(event.currentTarget.value)}>
          {VENUES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <nav className="kds-stations">
          {stations.map((name) => (
            <button key={name} type="button" className={name === station ? 'is-active' : ''} onClick={() => setStation(name)}>
              {name}
            </button>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        <span className="kds-count">{board?.tickets.length ?? 0} tickets</span>
      </header>

      {error ? <div className="kds-error">{error}</div> : null}

      {board && board.allDay.length > 0 ? (
        <div className="kds-allday">
          {board.allDay.map((item) => (
            <span key={item.name}>
              <b>{item.quantity}</b> {item.name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="kds-rail">
        {(board?.tickets ?? []).map((ticket) => {
          const age = ageSeconds(ticket.firedAt, now);
          const tone = age > 600 ? 'is-late' : age > 300 ? 'is-warn' : '';
          const byCourse = new Map<string, TicketLine[]>();
          for (const line of ticket.lines) {
            const key = line.course ?? 'Mains';
            byCourse.set(key, [...(byCourse.get(key) ?? []), line]);
          }
          return (
            <button key={ticket.id} type="button" className={`kds-ticket ${tone}`} onClick={() => void bump(ticket)}>
              <div className="kds-ticket-head">
                <strong>{ticket.tableLabel ? `T${ticket.tableLabel}` : `#${ticket.orderNumber}`}</strong>
                <span>{ticket.covers ? `${ticket.covers}pp` : ''}</span>
                <span className="kds-age">{ageLabel(age)}</span>
              </div>
              {ticket.openedByName ? <small className="kds-server">{ticket.openedByName}</small> : null}
              {Array.from(byCourse.entries()).map(([course, lines]) => (
                <div key={course} className="kds-course" data-course={courseTone(course)}>
                  <em>{course}</em>
                  {lines.map((line, index) => (
                    <div key={index} className="kds-line">
                      <b>
                        {line.quantity}× {line.name}
                        {line.seat ? ` · S${line.seat}` : ''}
                      </b>
                      {line.modifiers?.length ? <small>{line.modifiers.map((modifier) => modifier.name).join(', ')}</small> : null}
                      {line.notes ? <small className="kds-note">{line.notes}</small> : null}
                    </div>
                  ))}
                </div>
              ))}
              <span className="kds-bump-hint">tap to bump</span>
            </button>
          );
        })}
        {board && board.tickets.length === 0 ? <p className="kds-empty">All clear — no open tickets.</p> : null}
      </div>

      {board && board.recent.length > 0 ? (
        <footer className="kds-recent">
          <span className="kds-recent-label">Recall:</span>
          {board.recent.map((ticket) => (
            <button key={ticket.id} type="button" onClick={() => void bump(ticket, true)}>
              {ticket.tableLabel ? `T${ticket.tableLabel}` : `#${ticket.orderNumber}`}
            </button>
          ))}
        </footer>
      ) : null}
    </div>
  );
}
