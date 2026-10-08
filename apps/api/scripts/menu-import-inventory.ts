/**
 * The import inventory as Markdown: every reference menu and promotion the
 * importer knows, where it came from, how sure we are, what it maps to and
 * what the owner must check. Written to docs/menus-v2/import-inventory.md.
 *
 *   pnpm --filter @alma/api menus:import-inventory
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getMenuTemplate, isMenuTemplateKey, MENU_SECTION_TYPE_LABELS, validateMenuDocument } from '@alma/shared';
import { MENU_IMPORTS, PROMOTION_IMPORTS } from '../src/data/import/index.js';

const OUT = resolve(process.argv[2] ?? join(import.meta.dirname, '../../../docs/menus-v2/import-inventory.md'));

function esc(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

const lines: string[] = [];
lines.push('# Menus V2 — import inventory', '');
lines.push(
  'What `pnpm --filter @alma/api menus:import` creates, as reviewable drafts, from the reference menus (the website print sheets, the design folder PDFs) and the website\'s What\'s On events. Nothing here is approved content: every menu lands as an unpublished draft and every promotion as an unpublished listing, with the source, the confidence and the review notes on its audit trail. Regenerate with `pnpm --filter @alma/api menus:import-inventory`.',
  ''
);
lines.push('## Menus', '');
lines.push('| Venue · menu | Kind · template | Pages · sections · items | Confidence | Source |', '|---|---|---|---|---|');
for (const spec of MENU_IMPORTS) {
  const doc = spec.document;
  const items = doc.sections.reduce((count, section) => count + section.items.length, 0);
  const template = isMenuTemplateKey(spec.templateKey) ? getMenuTemplate(spec.templateKey) : null;
  lines.push(
    `| ${esc(spec.venueSlug)} · **${esc(spec.name)}** (\`${spec.slug}\`) | ${spec.kind} · \`${spec.templateKey}\`${template ? ` (${template.format})` : ''} | ${doc.pageCount} · ${doc.sections.length} · ${items} | ${spec.confidence} | ${esc(spec.source.path)}${spec.source.ref ? ` @ ${esc(spec.source.ref)}` : ''}${spec.source.modifiedAt ? `, ${spec.source.modifiedAt.slice(0, 10)}` : ''} |`
  );
}
lines.push('');
for (const spec of MENU_IMPORTS) {
  const doc = spec.document;
  const template = isMenuTemplateKey(spec.templateKey) ? getMenuTemplate(spec.templateKey) : null;
  const validation = validateMenuDocument(doc, { kind: spec.kind, maxPages: template?.multiPage ? template.maxPages ?? 24 : 1 });
  lines.push(`### ${spec.venueSlug} · ${spec.name}`, '');
  lines.push(`- Source: ${spec.source.path}${spec.source.ref ? ` (ref ${spec.source.ref})` : ''}${spec.source.hash ? `, hash \`${spec.source.hash.slice(0, 16)}…\`` : ''}${spec.source.modifiedAt ? `, modified ${spec.source.modifiedAt.slice(0, 10)}` : ''}.`);
  lines.push(`- Checked against: ${spec.source.notes}`);
  lines.push(`- Heading "${doc.heading || (template?.title ?? '')}"${doc.subheading ? `, subheading "${doc.subheading}"` : ''}${doc.whenLine ? `, when "${doc.whenLine}"` : ''}${doc.heroPriceCents !== null ? `, hero price ${doc.heroPriceCents / 100}${doc.heroPriceUnit ? ` ${doc.heroPriceUnit}` : ''}` : ''}.`);
  const types = new Map<string, number>();
  for (const section of doc.sections) types.set(section.sectionType, (types.get(section.sectionType) ?? 0) + 1);
  lines.push(`- Sections by type: ${[...types.entries()].map(([type, count]) => `${count} × ${MENU_SECTION_TYPE_LABELS[type as keyof typeof MENU_SECTION_TYPE_LABELS] ?? type}`).join(', ')}.`);
  lines.push(`- Validation: ${validation.errors.length} error(s), ${validation.warnings.length} warning(s)${validation.warnings.length ? ` — ${validation.warnings.slice(0, 3).map((issue) => issue.message).join('; ')}${validation.warnings.length > 3 ? '; …' : ''}` : ''}.`);
  lines.push('- Review before publishing:');
  for (const note of spec.review) lines.push(`  - ${note}`);
  lines.push('');
}
lines.push('## Promotions (What\'s On)', '');
lines.push('| Venue · promotion | Listing | Card | Photo | Confidence |', '|---|---|---|---|---|');
for (const spec of PROMOTION_IMPORTS) {
  lines.push(`| ${esc(spec.venueSlug)} · **${esc(spec.name)}** (\`${spec.slug}\`) | ${esc(spec.dayLabel)} · ${esc(spec.timeLabel)}${spec.priceLabel ? ` · ${esc(spec.priceLabel)}` : ''} | ${spec.cardSlug ? `\`${spec.cardSlug}\`` : '—'} | ${spec.image ? esc(spec.image.path) : '—'} | ${spec.confidence} |`);
}
lines.push('');
for (const spec of PROMOTION_IMPORTS) {
  lines.push(`### ${spec.venueSlug} · ${spec.name}`, '');
  lines.push(`- Listing copy: "${spec.summary}"`);
  lines.push(`- Weekdays ${spec.validDays.join(', ')} (0 = Sunday), start ${spec.startTime ?? '—'}; booking button: Reserve (OpenTable).`);
  lines.push(`- Price and conditions come from the card "${spec.cardSlug ?? '—'}" when linked.`);
  lines.push('- Review before publishing:');
  for (const note of spec.review) lines.push(`  - ${note}`);
  lines.push('');
}
writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`wrote ${OUT}: ${MENU_IMPORTS.length} menus, ${PROMOTION_IMPORTS.length} promotions`);
