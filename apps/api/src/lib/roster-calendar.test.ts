import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRosterCalendar,
  escapeIcsText,
  foldIcsLine,
  icsTimestamp,
  shiftSequence,
  shiftSummary,
  shiftUid,
  webcalUrl,
  rosterShiftLine
} from '@alma/shared';

const NOW = new Date('2026-08-21T04:00:00.000Z');

const shift = (over: Record<string, unknown> = {}) => ({
  id: 'shf_1',
  startsAt: '2026-08-22T07:00:00.000Z',
  endsAt: '2026-08-22T15:30:00.000Z',
  venue: 'St Alma',
  area: 'Floor',
  roleTitle: 'Bar',
  breakMinutes: 30,
  notes: null,
  updatedAt: '2026-08-21T03:00:00.000Z',
  status: 'PUBLISHED',
  ...over
});

const build = (shifts: unknown[]) =>
  buildRosterCalendar({ shifts: shifts as never, staffName: 'Isla Pegler', now: NOW });

const lines = (ics: string) => ics.split('\r\n');

describe('icsTimestamp', () => {
  it('emits basic-format UTC', () => {
    assert.equal(icsTimestamp('2026-08-22T07:00:00.000Z'), '20260822T070000Z');
  });

  it('accepts a Date as readily as a string', () => {
    assert.equal(icsTimestamp(new Date('2026-01-01T00:00:00Z')), '20260101T000000Z');
  });

  it('refuses a bad date rather than emitting NaN into the feed', () => {
    assert.throws(() => icsTimestamp('not a date'), /Invalid calendar date/);
  });
});

describe('escapeIcsText', () => {
  it('escapes the three structural characters', () => {
    assert.equal(escapeIcsText('a;b,c\\d'), 'a\;b\\,c\\\\d');
  });

  it('turns real newlines into the literal escape', () => {
    assert.equal(escapeIcsText('one\ntwo'), 'one\\ntwo');
    assert.equal(escapeIcsText('one\r\ntwo'), 'one\\ntwo');
  });

  it('leaves ordinary text alone', () => {
    assert.equal(escapeIcsText('Bar · St Alma'), 'Bar · St Alma');
  });
});

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    assert.equal(foldIcsLine('SUMMARY:Bar'), 'SUMMARY:Bar');
  });

  it('folds at 75 octets with a leading space on continuations', () => {
    const folded = foldIcsLine('DESCRIPTION:' + 'x'.repeat(200));
    const parts = folded.split('\r\n');
    assert.ok(parts.length > 1, 'expected the line to fold');
    assert.ok(parts[0]!.length <= 75, `first segment ${parts[0]!.length} > 75`);
    for (const part of parts.slice(1)) {
      assert.equal(part[0], ' ', 'continuation must start with a space');
      assert.ok(new TextEncoder().encode(part).length <= 75);
    }
  });

  it('measures octets, not characters, and never splits one', () => {
    // 'é' is two octets in UTF-8. 60 of them plus the property name is under
    // 75 characters but over 75 octets — folding on length would let it past.
    const folded = foldIcsLine('SUMMARY:' + 'é'.repeat(60));
    for (const part of folded.split('\r\n')) {
      assert.ok(new TextEncoder().encode(part).length <= 75);
    }
    // Nothing lost or mangled on the way through.
    assert.equal(folded.split('\r\n ').join('').replace('SUMMARY:', ''), 'é'.repeat(60));
  });
});

describe('shiftUid', () => {
  it('is stable for the same shift, so an amendment replaces rather than duplicates', () => {
    assert.equal(shiftUid('shf_1'), shiftUid('shf_1'));
  });

  it('differs between shifts', () => {
    assert.notEqual(shiftUid('shf_1'), shiftUid('shf_2'));
  });
});

describe('shiftSequence', () => {
  it('climbs when the shift is amended', () => {
    const before = shiftSequence(shift({ updatedAt: '2026-08-21T03:00:00Z' }) as never);
    const after = shiftSequence(shift({ updatedAt: '2026-08-21T05:00:00Z' }) as never);
    assert.ok(after > before, `${after} should be greater than ${before}`);
  });

  it('is zero rather than NaN when there is nothing to go on', () => {
    assert.equal(shiftSequence({ id: 'x', startsAt: NOW, endsAt: NOW } as never), 0);
    assert.equal(shiftSequence(shift({ updatedAt: 'rubbish' }) as never), 0);
  });
});

describe('shiftSummary', () => {
  it('leads with the role and names the venue', () => {
    assert.equal(shiftSummary(shift() as never), 'Bar · St Alma');
  });

  it('falls back to the area when there is no role', () => {
    assert.equal(shiftSummary(shift({ roleTitle: null }) as never), 'Floor · St Alma');
  });

  it('still says something when it knows nothing', () => {
    assert.equal(shiftSummary({ id: 'x', startsAt: NOW, endsAt: NOW } as never), 'Shift');
  });
});

describe('buildRosterCalendar', () => {
  it('wraps the events in a well-formed calendar', () => {
    const ics = build([shift()]);
    const l = lines(ics);
    assert.equal(l[0], 'BEGIN:VCALENDAR');
    assert.equal(l.at(-2), 'END:VCALENDAR');
    assert.ok(ics.includes('VERSION:2.0'));
    assert.ok(ics.includes('METHOD:PUBLISH'));
    assert.ok(ics.includes('X-WR-CALNAME:Isla Pegler · ALMA shifts'));
  });

  it('ends every line with CRLF, including the last', () => {
    const ics = build([shift()]);
    assert.ok(ics.endsWith('\r\n'));
    assert.equal(ics.includes('\n\n'), false);
    // No bare LF anywhere: a lone newline is what makes strict parsers give up.
    assert.equal(/[^\r]\n/.test(ics), false);
  });

  it('balances BEGIN and END for every event', () => {
    const ics = build([shift(), shift({ id: 'shf_2' })]);
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.equal((ics.match(/END:VEVENT/g) || []).length, 2);
  });

  it('carries the times through as UTC', () => {
    const ics = build([shift()]);
    assert.ok(ics.includes('DTSTART:20260822T070000Z'));
    assert.ok(ics.includes('DTEND:20260822T153000Z'));
  });

  it('puts the break and the note in the description', () => {
    const ics = build([shift({ notes: 'Bring your RSA' })]);
    assert.ok(ics.includes('Break: 30 min'));
    assert.ok(ics.includes('Bring your RSA'));
  });

  it('keeps a cancelled shift in the feed, marked cancelled', () => {
    // Dropping it would leave it on the phone forever — a subscription only
    // learns about a deletion if it is told.
    const ics = build([shift({ status: 'CANCELLED' })]);
    assert.ok(ics.includes('STATUS:CANCELLED'));
    assert.ok(ics.includes('SUMMARY:CANCELLED — Bar · St Alma'));
  });

  it('survives a venue with a comma in it', () => {
    const ics = build([shift({ venue: 'Alma, Avalon' })]);
    assert.ok(ics.includes('LOCATION:Alma\\, Avalon'));
    // And the comma has not split LOCATION into two values.
    const location = lines(ics).find((line) => line.startsWith('LOCATION:'))!;
    assert.equal(location, 'LOCATION:Alma\\, Avalon');
  });

  it('produces an empty but valid calendar when nobody is on', () => {
    const ics = build([]);
    assert.ok(ics.includes('BEGIN:VCALENDAR'));
    assert.ok(ics.includes('END:VCALENDAR'));
    assert.equal(ics.includes('BEGIN:VEVENT'), false);
  });

  it('folds a long manager note without corrupting it', () => {
    const note = 'Please arrive fifteen minutes early for the pre-service briefing in the back dining room';
    const ics = build([shift({ notes: note })]);
    for (const line of lines(ics)) {
      assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line}`);
    }
    const unfolded = ics.split('\r\n ').join('');
    assert.ok(unfolded.includes(note.replace(/,/g, '\\,')));
  });
});

describe('webcalUrl', () => {
  it('swaps the scheme so the phone subscribes instead of downloading once', () => {
    assert.equal(
      webcalUrl('https://api.almagroup.com.au/api/staff/calendar/abc.ics'),
      'webcal://api.almagroup.com.au/api/staff/calendar/abc.ics'
    );
  });

  it('handles http too', () => {
    assert.equal(webcalUrl('http://localhost:3018/x.ics'), 'webcal://localhost:3018/x.ics');
  });
});

describe('rosterShiftLine — what the staff member actually reads', () => {
  it('renders a shift in venue time, not the server\'s UTC', () => {
    // 22 Aug 2026 07:00Z is 5pm Sydney (AEST, +10) on the SAME day.
    const line = rosterShiftLine({
      startsAt: '2026-08-22T07:00:00Z',
      endsAt: '2026-08-22T13:00:00Z',
      venue: 'St Alma',
      roleTitle: 'Bar',
      area: 'Floor'
    });
    assert.equal(line.day, 'Saturday 22 August');
    assert.equal(line.hours, '5:00pm – 11:00pm');
    assert.equal(line.where, 'Bar · St Alma');
    assert.equal(line.area, 'Floor');
  });

  it('still says the right day when UTC has already rolled over', () => {
    // 22 Aug 2026 14:00Z is midnight Sydney — 23 August locally. Reading the
    // instant in UTC would put this shift on the wrong day.
    const line = rosterShiftLine({ startsAt: '2026-08-22T14:00:00Z', endsAt: '2026-08-22T16:00:00Z' });
    assert.equal(line.day, 'Sunday 23 August');
    assert.equal(line.hours, '12:00am – 2:00am');
  });

  it('handles daylight saving on both sides of the change', () => {
    // AEST (+10) in July.
    const winter = rosterShiftLine({ startsAt: '2026-07-01T07:00:00Z', endsAt: '2026-07-01T09:00:00Z' });
    assert.equal(winter.hours, '5:00pm – 7:00pm');
    // AEDT (+11) in January — the same UTC hour is an hour later locally.
    const summer = rosterShiftLine({ startsAt: '2026-01-01T07:00:00Z', endsAt: '2026-01-01T09:00:00Z' });
    assert.equal(summer.hours, '6:00pm – 8:00pm');
  });

  it('leaves no stray whitespace in the times', () => {
    // Intl emits a narrow no-break space before am/pm, which a plain \s misses.
    const line = rosterShiftLine({ startsAt: '2026-08-22T07:00:00Z', endsAt: '2026-08-22T13:00:00Z' });
    assert.equal(/[\s  ]/.test(line.hours.replace(' – ', '')), false);
  });

  it('always says something for where, even with nothing to go on', () => {
    const line = rosterShiftLine({ startsAt: '2026-08-22T07:00:00Z', endsAt: '2026-08-22T09:00:00Z' });
    assert.equal(line.where, 'Shift');
    assert.equal(line.area, null);
  });

  it('names the venue on its own when there is no role', () => {
    const line = rosterShiftLine({ startsAt: '2026-08-22T07:00:00Z', endsAt: '2026-08-22T09:00:00Z', venue: 'Alma Avalon' });
    assert.equal(line.where, 'Alma Avalon');
  });
});

/**
 * Unfold and parse a calendar back into events, the way a client does.
 *
 * Unit tests cover folding and escaping separately; this is where they meet.
 * A long line containing a comma folds *and* escapes, and getting either wrong
 * corrupts the other — which a client reports by showing nothing at all.
 */
function parseIcs(ics: string): Array<Record<string, string>> {
  const unfolded = ics.split('\r\n ').join('');
  const events: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;
  for (const line of unfolded.split('\r\n')) {
    if (line === 'BEGIN:VEVENT') { current = {}; continue; }
    if (line === 'END:VEVENT') { if (current) events.push(current); current = null; continue; }
    if (!current || !line) continue;
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).split(';')[0]!;
    current[key] = line
      .slice(at + 1)
      .replace(/\\n/g, '\n')
      .replace(/\\,/g, ',')
      .replace(/\;/g, ';')
      .replace(/\\\\/g, '\\');
  }
  return events;
}

describe('a realistic week, unfolded and read back', () => {
  const week = [
    { id: 'a', startsAt: '2026-08-24T07:00:00Z', endsAt: '2026-08-24T13:00:00Z', venue: 'St Alma', area: 'Floor', roleTitle: 'Bar', breakMinutes: 30, notes: null, updatedAt: '2026-08-21T00:00:00Z', status: 'PUBLISHED' },
    { id: 'b', startsAt: '2026-08-26T02:00:00Z', endsAt: '2026-08-26T09:30:00Z', venue: 'Alma, Avalon', area: 'Kitchen', roleTitle: 'Chef de partie', breakMinutes: 45, notes: 'Deliveries land at 1pm; please check the temps and sign the sheet before service, and let Caio know if anything is short.', updatedAt: '2026-08-21T00:00:00Z', status: 'PUBLISHED' },
    { id: 'c', startsAt: '2026-08-28T08:00:00Z', endsAt: '2026-08-28T14:00:00Z', venue: 'St Alma', area: 'Café', roleTitle: 'Floor Night', breakMinutes: 0, notes: 'Naïve façade — unicode check', updatedAt: '2026-08-21T00:00:00Z', status: 'CANCELLED' }
  ];

  const ics = buildRosterCalendar({ shifts: week as never, staffName: 'Elke Schultz', now: NOW });
  const events = parseIcs(ics);

  it('gives back every shift, and only those', () => {
    assert.equal(events.length, 3);
    assert.deepEqual(events.map((e) => e.UID), ['a', 'b', 'c'].map((id) => shiftUid(id)));
  });

  it('never emits a line over 75 octets anywhere in the file', () => {
    for (const line of ics.split('\r\n')) {
      assert.ok(new TextEncoder().encode(line).length <= 75, `too long: ${line.slice(0, 40)}…`);
    }
  });

  it('brings a comma in a venue name back intact, not split into two values', () => {
    assert.equal(events[1]!.LOCATION, 'Alma, Avalon');
  });

  it('brings a long note back whole, through the fold', () => {
    assert.equal(
      events[1]!.DESCRIPTION,
      'Area: Kitchen\nRole: Chef de partie\nBreak: 45 min\nDeliveries land at 1pm; please check the temps and sign the sheet before service, and let Caio know if anything is short.'
    );
  });

  it('keeps multi-byte characters intact across a fold', () => {
    assert.ok(events[2]!.DESCRIPTION!.includes('Naïve façade — unicode check'));
    assert.equal(events[2]!.SUMMARY, 'CANCELLED — Floor Night · St Alma');
  });

  it('marks the cancelled one cancelled rather than dropping it', () => {
    assert.equal(events[2]!.STATUS, 'CANCELLED');
    assert.equal(events[0]!.STATUS, 'CONFIRMED');
  });

  it('carries start and end for every event', () => {
    for (const event of events) {
      assert.match(event.DTSTART!, /^\d{8}T\d{6}Z$/);
      assert.match(event.DTEND!, /^\d{8}T\d{6}Z$/);
      assert.ok(Number(event.SEQUENCE) >= 0);
    }
  });
});
