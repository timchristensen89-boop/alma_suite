// Pure date/time/format helpers shared across the staff-web pages.
// Lifted out of App.tsx as the first step of the staff-web breakup
// (docs/STAFF_WEB_BREAKUP.md) — no behaviour change, just a shared home so
// per-feature page modules can import from one place.
import type { RosterShift, StaffProfile, Timesheet } from '@alma/shared';

export function startOfWeek(reference: Date) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return start;
}

export function addDays(reference: Date, days: number) {
  const date = new Date(reference);
  date.setDate(reference.getDate() + days);
  return date;
}

export function shiftTimeRange(date: string, startTime: string, endTime: string) {
  if (!date || !startTime || !endTime) return null;
  const startsAt = new Date(`${date}T${startTime}:00`);
  const endsAt = new Date(`${date}T${endTime}:00`);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);
  return { startsAt, endsAt };
}

export function moveDateKeepingTime(value: string, targetDay: Date) {
  const source = new Date(value);
  const next = new Date(targetDay);
  next.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
  return next;
}

export function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function isDateInRange(value: Date, start: Date, end: Date) {
  const time = value.getTime();
  return !Number.isNaN(time) && time >= start.getTime() && time < end.getTime();
}

export function rangesOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

export function timeOf(value: string) {
  const d = new Date(value);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function toDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function toTimeInput(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

export function isExpiringSoon(iso: string) {
  const expiry = new Date(iso);
  if (Number.isNaN(expiry.getTime())) return false;
  const now = new Date();
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return expiry <= soon && expiry >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
}

export function formatRange(start: Date, end: Date) {
  return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })}`;
}

export function shiftHours(shift: RosterShift) {
  const startsAt = new Date(shift.startsAt).getTime();
  const endsAt = new Date(shift.endsAt).getTime();
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= startsAt) return 0;
  return (endsAt - startsAt) / 36e5;
}

export function roundHours(hours: number) {
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
}

export function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function initials(member: Pick<StaffProfile, 'firstName' | 'lastName'>) {
  return `${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}`.toUpperCase() || 'A';
}

export function timesheetHours(entry: Timesheet) {
  const startsAt = new Date(entry.clockInAt).getTime();
  const endsAt = new Date(entry.clockOutAt).getTime();
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= startsAt) return 0;
  return Math.max(0, (endsAt - startsAt) / 36e5 - entry.breakMinutes / 60);
}

export function formatCents(value: number | null | undefined) {
  if (value === null || value === undefined) return 'No rate';
  return (value / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'AUD'
  });
}
