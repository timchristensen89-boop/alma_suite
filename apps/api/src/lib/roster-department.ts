// Which department a rostered shift belongs to — kitchen (BOH), front of
// house, or management — decided from what the roster actually says.
//
// The roster has no department field. A shift carries a free-text `area`
// ("Kitchen", "Floor", "Bar", a Deputy operational unit name) and a free-text
// `roleTitle`, and the person has a profile `roleTitle` ("Head Chef",
// "Venue Manager"). The Labour vs takings page used to pour every hour into
// one "Labour %", so a kitchen-only reading was impossible to get and a
// total was impossible to split. This classifier reads the three labels in
// that order of trust — the shift's area first (it is what the manager set
// on the board), then the shift's role, then the person's usual role — and
// says which one decided. A shift none of them can place is UNCLASSIFIED:
// it stays in the totals, is shown as unclassified, and is never silently
// dumped into FOH.

import type { RosterDepartment } from '@alma/shared';
export type { RosterDepartment };

export type RosterDepartmentResult = {
  department: RosterDepartment;
  /** Which label decided, e.g. "area: Kitchen" or "profile role: Head Chef". */
  basis: string;
};

const KITCHEN = /\b(kitchen|boh|back of house|chef|cook|dish|dishy|dishwash|kp|kitchen ?hand|pastry|prep|pass|sous|larder|baker)\b/i;
const FOH = /\b(foh|front of house|floor|bar|barista|host|hostess|wait|waiter|waitress|service|runner|sommelier|bartender|cashier|counter|front|events?|function)\b/i;
const MANAGEMENT = /\b(manager|management|gm|general manager|owner|director|operations|ops|admin|office|head office|bookkeep)\b/i;

function classifyLabel(label: string | null | undefined): RosterDepartment | null {
  const value = (label ?? '').trim();
  if (!value) return null;
  // Kitchen wins over management so a "Kitchen Manager" or "Head Chef" is
  // kitchen labour; floor wins over management so a "Floor Manager" is FOH.
  // Only a label with no kitchen or floor word in it is management.
  if (KITCHEN.test(value)) return 'KITCHEN';
  if (FOH.test(value)) return 'FOH';
  if (MANAGEMENT.test(value)) return 'MANAGEMENT';
  return null;
}

export function classifyRosterDepartment(input: {
  area?: string | null;
  shiftRoleTitle?: string | null;
  profileRoleTitle?: string | null;
}): RosterDepartmentResult {
  const candidates: Array<[string, string | null | undefined]> = [
    ['area', input.area],
    ['shift role', input.shiftRoleTitle],
    ['profile role', input.profileRoleTitle]
  ];
  for (const [name, label] of candidates) {
    const department = classifyLabel(label);
    if (department) return { department, basis: `${name}: ${(label ?? '').trim()}` };
  }
  const seen = candidates.map(([, label]) => (label ?? '').trim()).filter(Boolean);
  return { department: 'UNCLASSIFIED', basis: seen.length ? `no department word in: ${seen.join(' / ')}` : 'no area or role on the shift or profile' };
}
