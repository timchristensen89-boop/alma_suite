/**
 * Rebuild the guest rollups and re-apply the automatic tags, then report.
 *
 *   node --import tsx scripts/guest-crm-refresh.ts [--dry]
 *
 * The nightly job does the same thing. This exists for after an import, and
 * for checking what a rule change would do before it does it.
 */
import { guestCrmService } from '../src/services/guest-crm.service.js';

const dry = process.argv.includes('--dry');

if (!dry) console.log('seed rules :', JSON.stringify(await guestCrmService.seedDefaultTagRules()));
if (!dry) console.log('rollups    :', JSON.stringify(await guestCrmService.rebuildGuestRollups()));
console.log('tags       :', JSON.stringify(await guestCrmService.applyAutomaticTags({ dryRun: dry })));

const summary = await guestCrmService.summary();
console.log(
  `\nguests ${summary.guests} | email ${summary.withEmail} | phone ${summary.withPhone} | reachable ${summary.reachableByEmail}`
);
console.log(`visited ${summary.visited} | lapsed ${summary.lapsed}\n`);
for (const tag of summary.tags) console.log(`  ${String(tag.guests).padStart(5)}  ${tag.name}`);
process.exit(0);
