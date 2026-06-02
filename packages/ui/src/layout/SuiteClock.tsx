import { useEffect, useState } from 'react';

type Props = {
  /** IANA timezone for the displayed time. Defaults to the venue timezone. */
  timeZone?: string;
  className?: string;
};

// Every venue trades on Sydney time, so the suite clock is anchored there by
// default rather than the device's local zone — a manager checking from home
// (or a server-rendered surface) still sees venue time.
const DEFAULT_TZ = 'Australia/Sydney';

function readClock(timeZone: string): { day: string; time: string } {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-AU', { weekday: 'short', timeZone }).format(now);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone
  }).format(now);
  return { day, time };
}

// Compact live clock for the suite top bar: "Tue 19:42" in 24h venue time.
// Updates every 15s so the minute is never stale without spinning a 1s timer.
export function SuiteClock({ timeZone = DEFAULT_TZ, className = '' }: Props) {
  const [clock, setClock] = useState(() => readClock(timeZone));

  useEffect(() => {
    const tick = () => setClock(readClock(timeZone));
    tick();
    const id = window.setInterval(tick, 15_000);
    return () => window.clearInterval(id);
  }, [timeZone]);

  return (
    <div
      className={`suite-clock ${className}`.trim()}
      title={`${clock.day} ${clock.time} · Sydney`}
      aria-label={`Current time ${clock.time}, Sydney`}
    >
      <span className="suite-clock-day" aria-hidden="true">
        {clock.day}
      </span>
      <span className="suite-clock-time">{clock.time}</span>
    </div>
  );
}
