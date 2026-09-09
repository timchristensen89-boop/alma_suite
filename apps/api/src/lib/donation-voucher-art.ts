/**
 * The sponsorship voucher artwork.
 *
 * A donated voucher is the one card that goes to a room full of people who
 * have never heard of us: it sits on a raffle table, gets held up from a
 * stage, is photographed for a school newsletter. So it carries the
 * organisation's name as the headline, not ours — "Presented with our support
 * to Manly Nippers" is the marketing, and the ALMA mark is the signature
 * under it.
 *
 * Redrawn September 2026 from the Claude Design project "ALMA Group
 * Sponsorship Voucher": a low sun off the top-right corner with a fan of thin
 * gold rays, agave kept very quiet in both bottom corners, a fine double gold
 * rule, the value in a gold pill and the code in a soft monospaced box.
 *
 * Pure SVG, no fonts loaded, no images fetched: it renders identically as an
 * email attachment, on the printable page, and in a preview. That constraint
 * is why the type is Georgia rather than the Playfair Display the design was
 * drawn in — a voucher that arrives as an attachment has to look right in
 * whatever opens it, and a webfont that half the mail clients ignore is worse
 * than a serif that is everywhere.
 *
 * The one layout problem is the organisation name, which can be three letters
 * or fifty, so it is fitted to the space rather than fixed, and the blocks
 * below it are laid out around whatever it takes — the same arithmetic a
 * space-between column would do, done by hand because SVG has no flexbox.
 */

export type DonationVoucherArt = {
  organisation: string;
  cause?: string | null;
  venue: string;
  code: string;
  amountLabel: string;
  expiryLabel: string;
  conditions: string;
  /** Cream wordmark PNG for the signature block; falls back to type. */
  logoBase64?: string | null;
};

export const VOUCHER_WIDTH = 1200;
export const VOUCHER_HEIGHT = 756;

/**
 * The safe margin. The outer gold rule sits on it rather than outside it, so
 * nothing ink-bearing is at risk if a printed voucher is trimmed.
 */
const SAFE = 60;
const SAFE_INNER = 67;

/** The left margin the text hangs from, and the right edge it runs to. */
const LEFT = 96;
const RIGHT = VOUCHER_WIDTH - 96;

/** Content sits between these, and the three blocks are spread across them. */
const CONTENT_TOP = 88;
const CONTENT_BOTTOM = 670;

/** The name may run this wide before it wraps, and this tall before it shrinks. */
const NAME_WIDTH = 860;
/**
 * How tall the name may stand. Derived from what is left of the card once the
 * eyebrow, the rule, the value row, the footer and the minimum gaps between
 * them have taken their share — so the name can never push the conditions
 * line off the bottom. A cause line costs the name some of that room.
 */
const NAME_BOX = 186;
const NAME_BOX_WITH_CAUSE = 146;
const NAME_MAX = 124;
const NAME_MIN = 44;
/** Tight on one line; opened up once it stacks. */
const NAME_LEAD = 0.92;
const NAME_LEAD_MULTI = 1;
/** No name is worth more than four lines — past that it is not a headline. */
const NAME_MAX_LINES = 4;

/** Average glyph width as a fraction of font size for a bold serif at display sizes. */
const SERIF_GLYPH_RATIO = 0.56;

/* How tall each block stands, so the card can be laid out before it is drawn. */
const EYEBROW_H = 30;
const HEAD_GAP = 16;
/** The gap under the name plus the "DINNER ON US" rule itself. */
const TAGLINE_H = 48;
const CAUSE_H = 40;
const VALUE_H = 89;
const FOOT_H = 141;
/** The gaps between the three blocks open up, but never close past this. */
const GAP_FLOOR = 36;
const LOGO_H = 78;
/** The wordmark's own proportions, so the signature keeps its shape. */
const LOGO_ASPECT = 1.94;

const GREEN_DEEP = '#14241A';
const CREAM = '#F5DCCE';
const GOLD = '#C9A24C';

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";
const MONO = "'Courier New', Courier, monospace";

export function escapeSvg(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Break a name into at most `maxLines` lines that each fit `width` at the
 * given size. Words are never split; a single word wider than the line just
 * overflows, which the caller avoids by shrinking first.
 */
export function wrapWords(text: string, fontSize: number, width: number, maxLines: number): string[] {
  const maxChars = Math.max(1, Math.floor(width / (fontSize * SERIF_GLYPH_RATIO)));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines;
}

/** How tall a name of `lines` lines stands at `fontSize`. */
function nameHeight(fontSize: number, lines: number): number {
  return lines === 1 ? fontSize * NAME_LEAD : fontSize * NAME_LEAD_MULTI * lines;
}

/**
 * The largest size at which the organisation still fits the space above the
 * value row.
 *
 * The name is the loudest thing on the card and has to stay that way, so this
 * walks down from the display size and takes the first that fits rather than
 * settling for a comfortable default. "RSL" prints at 124; "Manly Warringah
 * Sea Eagles Junior Rugby League Club" comes down to three readable lines.
 */
export function fitOrganisation(organisation: string, box: number = NAME_BOX): { fontSize: number; lines: string[] } {
  for (let fontSize = NAME_MAX; fontSize >= NAME_MIN; fontSize -= 1) {
    const lines = wrapWords(organisation, fontSize, NAME_WIDTH, NAME_MAX_LINES);
    // wrapWords stops at the cap, so a name that needed more lines than it was
    // allowed comes back short of its own words. That is not a fit.
    if (lines.join(' ').split(/\s+/).length !== organisation.trim().split(/\s+/).filter(Boolean).length) continue;
    if (nameHeight(fontSize, lines.length) <= box) return { fontSize, lines };
  }
  return { fontSize: NAME_MIN, lines: wrapWords(organisation, NAME_MIN, NAME_WIDTH, NAME_MAX_LINES) };
}

export type VoucherLayout = {
  fontSize: number;
  lines: string[];
  /** Baseline-to-baseline distance for the name. */
  lead: number;
  nameTop: number;
  taglineY: number;
  causeY: number;
  valueTop: number;
  footTop: number;
  hairlineY: number;
  conditionsY: number;
};

/**
 * Where everything sits on the card.
 *
 * This is what a space-between column would do, done by hand: the head, the
 * value row and the footer take the height they need, and whatever is left
 * over is split evenly between them, never closing past a floor. The name is
 * the only part that changes size, so the blocks below it move down rather
 * than being overlapped by it.
 *
 * `fitOrganisation` is bounded so that even the tallest name it can return
 * leaves room for the two floor gaps, which is what keeps the conditions line
 * on the card for every name.
 */
export function voucherLayout(organisation: string, hasCause: boolean): VoucherLayout {
  const { fontSize, lines } = fitOrganisation(organisation, hasCause ? NAME_BOX_WITH_CAUSE : NAME_BOX);
  const nameH = nameHeight(fontSize, lines.length);

  const headH = EYEBROW_H + HEAD_GAP + nameH + TAGLINE_H + (hasCause ? CAUSE_H : 0);
  const slack = CONTENT_BOTTOM - CONTENT_TOP - headH - VALUE_H - FOOT_H;
  const gap = Math.max(GAP_FLOOR, slack / 2);

  const nameTop = CONTENT_TOP + EYEBROW_H + HEAD_GAP;
  const taglineY = nameTop + nameH + 26;
  const valueTop = CONTENT_TOP + headH + gap;
  const footTop = valueTop + VALUE_H + gap;
  const hairlineY = footTop + LOGO_H + 20;

  return {
    fontSize,
    lines,
    lead: lines.length === 1 ? fontSize * NAME_LEAD : fontSize * NAME_LEAD_MULTI,
    nameTop,
    taglineY,
    causeY: taglineY + 40,
    valueTop,
    footTop,
    hairlineY,
    conditionsY: hairlineY + 38
  };
}

/** A fan of thin rays and a low sun, off the top-right corner. */
function sun(): string {
  const rays = [6, 14, 22, 30, 38, 46, 54, 62, 70, 78, 86]
    .map(
      (angle) =>
        `<line x1="0" y1="0" x2="0" y2="1020" transform="rotate(${angle})" stroke="${GOLD}" stroke-opacity="0.3" stroke-width="1.2"/>`
    )
    .join('\n    ');
  return `<g transform="translate(1160,-56)">
    ${rays}
  </g>
  <circle cx="1160" cy="-56" r="196" fill="${GOLD}" opacity="0.16"/>
  <circle cx="1160" cy="-56" r="196" fill="none" stroke="${GOLD}" stroke-opacity="0.6" stroke-width="1.4"/>
  <circle cx="1160" cy="-56" r="252" fill="none" stroke="${GOLD}" stroke-opacity="0.3" stroke-width="1"/>`;
}

/** Agave, kept very quiet in the bottom corners. */
function agave(): string {
  const frond = (points: string, rotate?: number) =>
    `<polygon points="${points}"${rotate ? ` transform="rotate(${rotate})"` : ''}/>`;
  return `<g transform="translate(104,748)" fill="${GOLD}" opacity="0.14">
    ${frond('0,0 -8,-176 0,-206 8,-176')}
    ${frond('0,0 -8,-168 0,-196 8,-168', 20)}
    ${frond('0,0 -7,-150 0,-176 7,-150', 40)}
    ${frond('0,0 -6,-118 0,-138 6,-118', 58)}
    ${frond('0,0 -8,-168 0,-196 8,-168', -20)}
    ${frond('0,0 -7,-150 0,-176 7,-150', -40)}
    ${frond('0,0 -6,-118 0,-138 6,-118', -58)}
  </g>
  <g transform="translate(1104,752)" fill="${GOLD}" opacity="0.12">
    ${frond('0,0 -7,-150 0,-176 7,-150', 14)}
    ${frond('0,0 -7,-138 0,-162 7,-138', 36)}
    ${frond('0,0 -6,-116 0,-136 6,-116', 56)}
    ${frond('0,0 -7,-142 0,-166 7,-142', -10)}
    ${frond('0,0 -6,-118 0,-138 6,-118', -32)}
  </g>`;
}

export function donationVoucherSvg(input: DonationVoucherArt): string {
  const cause = input.cause?.trim() ? escapeSvg(input.cause.trim()) : '';
  const { fontSize, lines, lead, nameTop, taglineY, causeY, valueTop, footTop, hairlineY, conditionsY } =
    voucherLayout(input.organisation, Boolean(cause));

  // Georgia sets its cap height about 0.7 of the em above the baseline; the
  // rest of the line box sits under it. Placing the first baseline this way
  // keeps the name optically inside its box rather than riding the top of it.
  const firstBaseline = nameTop + fontSize * 0.74;
  const nameSvg = lines
    .map(
      (line, index) =>
        `<text x="${LEFT}" y="${Math.round(firstBaseline + index * lead)}" fill="${CREAM}" font-family="${SERIF}" font-size="${fontSize}" font-weight="700" letter-spacing="${-fontSize * 0.02}">${escapeSvg(line)}</text>`
    )
    .join('\n  ');

  // The signature. Always the real wordmark where we have it — a recreation in
  // Arial Black is a different mark, and this is the one place we sign.
  const signature = input.logoBase64
    ? `<image x="${LEFT}" y="${footTop}" width="${LOGO_H * LOGO_ASPECT}" height="${LOGO_H}" href="data:image/png;base64,${input.logoBase64}" preserveAspectRatio="xMinYMid meet"/>`
    : `<text x="${LEFT}" y="${footTop + 52}" fill="${CREAM}" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="58" font-weight="900" letter-spacing="-2">alma</text>
  <text x="${LEFT + 2}" y="${footTop + 74}" fill="${CREAM}" font-family="${SANS}" font-size="15" font-weight="700" letter-spacing="12">GROUP</text>`;

  const detailLabelY = footTop + 34;
  const detailValueY = footTop + 72;

  const pillW = 74 + input.amountLabel.length * 34;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VOUCHER_WIDTH}" height="${VOUCHER_HEIGHT}" viewBox="0 0 ${VOUCHER_WIDTH} ${VOUCHER_HEIGHT}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="0.62" y2="1">
      <stop offset="0" stop-color="${GREEN_DEEP}"/>
      <stop offset="0.52" stop-color="#1D2E20"/>
      <stop offset="1" stop-color="#233628"/>
    </linearGradient>
    <radialGradient id="heat" cx="0.92" cy="-0.12" r="0.72">
      <stop offset="0" stop-color="${GOLD}" stop-opacity="0.3"/>
      <stop offset="0.42" stop-color="${GOLD}" stop-opacity="0.1"/>
      <stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="card"><rect width="${VOUCHER_WIDTH}" height="${VOUCHER_HEIGHT}"/></clipPath>
  </defs>

  <rect width="${VOUCHER_WIDTH}" height="${VOUCHER_HEIGHT}" fill="url(#ground)"/>
  <rect width="${VOUCHER_WIDTH}" height="${VOUCHER_HEIGHT}" fill="url(#heat)"/>
  <g clip-path="url(#card)">
  ${sun()}
  ${agave()}
  </g>

  <rect x="${SAFE}" y="${SAFE}" width="${VOUCHER_WIDTH - SAFE * 2}" height="${VOUCHER_HEIGHT - SAFE * 2}" fill="none" stroke="${GOLD}" stroke-opacity="0.72" stroke-width="1.5"/>
  <rect x="${SAFE_INNER}" y="${SAFE_INNER}" width="${VOUCHER_WIDTH - SAFE_INNER * 2}" height="${VOUCHER_HEIGHT - SAFE_INNER * 2}" fill="none" stroke="${GOLD}" stroke-opacity="0.34" stroke-width="1"/>

  <text x="${LEFT}" y="${CONTENT_TOP + 22}" fill="${CREAM}" opacity="0.85" font-family="${SERIF}" font-size="24" font-style="italic">Presented with our support to</text>
  ${nameSvg}
  <line x1="${LEFT}" y1="${taglineY}" x2="${LEFT + 96}" y2="${taglineY}" stroke="${GOLD}" stroke-width="2"/>
  <text x="${LEFT + 112}" y="${taglineY + 6}" fill="${GOLD}" font-family="${SANS}" font-size="16" font-weight="700" letter-spacing="5.4">DINNER ON US</text>
  ${cause ? `<text x="${LEFT}" y="${causeY}" fill="${CREAM}" opacity="0.66" font-family="${SERIF}" font-size="22" font-style="italic">${cause}</text>` : ''}

  <rect x="${LEFT}" y="${valueTop}" width="${pillW}" height="${VALUE_H}" rx="${VALUE_H / 2}" fill="${GOLD}"/>
  <text x="${LEFT + pillW / 2}" y="${valueTop + 62}" text-anchor="middle" fill="${GREEN_DEEP}" font-family="${SERIF}" font-size="58" font-weight="700">${escapeSvg(input.amountLabel)}</text>
  <rect x="${LEFT + pillW + 28}" y="${valueTop + 13}" width="${28 + input.code.length * 21}" height="63" rx="12" fill="${CREAM}" fill-opacity="0.09" stroke="${GOLD}" stroke-opacity="0.5"/>
  <text x="${LEFT + pillW + 52}" y="${valueTop + 54}" fill="${CREAM}" font-family="${MONO}" font-size="24" letter-spacing="3.8">${escapeSvg(input.code)}</text>

  ${signature}
  <text x="${RIGHT}" y="${detailLabelY}" text-anchor="end" fill="${GOLD}" font-family="${SANS}" font-size="16" font-weight="700" letter-spacing="3.2">VALID UNTIL</text>
  <text x="${RIGHT}" y="${detailValueY}" text-anchor="end" fill="${CREAM}" font-family="${SERIF}" font-size="31">${escapeSvg(input.expiryLabel)}</text>
  <text x="${RIGHT - 260}" y="${detailLabelY}" text-anchor="end" fill="${GOLD}" font-family="${SANS}" font-size="16" font-weight="700" letter-spacing="3.2">DINE AT</text>
  <text x="${RIGHT - 260}" y="${detailValueY}" text-anchor="end" fill="${CREAM}" font-family="${SERIF}" font-size="31">${escapeSvg(input.venue)}</text>

  <line x1="${LEFT}" y1="${hairlineY}" x2="${RIGHT}" y2="${hairlineY}" stroke="${GOLD}" stroke-opacity="0.4" stroke-width="1"/>
  <text x="${LEFT}" y="${conditionsY}" fill="${CREAM}" opacity="0.66" font-family="${SANS}" font-size="16">${escapeSvg(input.conditions)}</text>
</svg>`;
}
