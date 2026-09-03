/**
 * The sponsorship voucher artwork.
 *
 * A donated voucher is the one card that goes to a room full of people who
 * have never heard of us: it sits on a raffle table, gets held up from a
 * stage, is photographed for a school newsletter. So it carries the
 * organisation's name as the headline, not ours — "Presented to Manly
 * Nippers" is the marketing, and the ALMA mark is the signature under it.
 *
 * Pure SVG, no fonts loaded, no images fetched: it renders identically as an
 * email attachment, on the printable page, and in a preview. The one
 * layout problem is the organisation name, which can be four letters or
 * forty, so the type size is fitted to the width rather than fixed.
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

/** The left margin the text hangs from. */
const LEFT = 96;
/** Text may run to here before it wraps or shrinks. */
const RIGHT = 1104;
const TEXT_WIDTH = RIGHT - LEFT;

/** Average glyph width as a fraction of font size for a bold serif at display sizes. */
const SERIF_GLYPH_RATIO = 0.56;

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

/**
 * The largest type size, from a ladder of sensible display sizes, at which
 * the organisation fits in two lines. "RSL" prints at 148; "Manly Warringah
 * Sea Eagles Junior Rugby League Club" comes down to something readable.
 */
export function fitOrganisation(organisation: string): { fontSize: number; lines: string[] } {
  const ladder = [148, 132, 116, 100, 88, 76, 66, 58, 52];
  for (const fontSize of ladder) {
    const lines = wrapWords(organisation, fontSize, TEXT_WIDTH, 2);
    // Above 88px a second line climbs into the "Presented to" line, so a
    // name that needs two lines at display size shrinks until it fits one,
    // and only wraps once it is small enough for two to stack cleanly.
    if (lines.length > 1 && fontSize > 88) continue;
    const maxChars = Math.floor(TEXT_WIDTH / (fontSize * SERIF_GLYPH_RATIO));
    const fits = lines.every((line) => line.length <= maxChars);
    const joined = lines.join(' ').split(/\s+/).length === organisation.trim().split(/\s+/).filter(Boolean).length;
    if (fits && joined) return { fontSize, lines };
  }
  const fontSize = ladder[ladder.length - 1]!;
  return { fontSize, lines: wrapWords(organisation, fontSize, TEXT_WIDTH, 2) };
}

export function donationVoucherSvg(input: DonationVoucherArt): string {
  const bg = '#14241A';
  const bg2 = '#233628';
  const cream = '#F5DCCE';
  const gold = '#C9A24C';
  const { fontSize, lines } = fitOrganisation(input.organisation);
  const lineHeight = fontSize * 1.02;
  // The name block is anchored so its baseline sits at 356 for one line and
  // grows upward for two, keeping the cause line and the code in place.
  const nameBottom = 372;
  const nameTop = nameBottom - lineHeight * (lines.length - 1);
  const nameSvg = lines
    .map(
      (line, index) =>
        `<text x="${LEFT}" y="${Math.round(nameTop + index * lineHeight)}" fill="${cream}" font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" font-weight="700" letter-spacing="-1">${escapeSvg(line)}</text>`
    )
    .join('\n  ');
  const cause = input.cause?.trim() ? escapeSvg(input.cause.trim()) : '';
  const signature = input.logoBase64
    ? `<image x="${LEFT}" y="596" width="196" height="100" href="data:image/png;base64,${input.logoBase64}" preserveAspectRatio="xMinYMid meet"/>`
    : `<text x="${LEFT}" y="650" fill="${cream}" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="58" font-weight="900" letter-spacing="-2">alma</text>
  <text x="${LEFT + 2}" y="682" fill="${cream}" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" letter-spacing="12">GROUP</text>`;

  // Sun lines: a quarter sunburst from the top right corner, the venues'
  // beaches at seven in the morning. Drawn thin and low-contrast so the name
  // stays the loudest thing on the card.
  const rays = Array.from({ length: 14 }, (_, index) => {
    const angle = (Math.PI / 2) * (index / 13);
    const x = 1200 - Math.cos(angle) * 760;
    const y = Math.sin(angle) * 760;
    return `<line x1="1200" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${gold}" stroke-opacity="0.16" stroke-width="1.5"/>`;
  }).join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${VOUCHER_WIDTH}" height="${VOUCHER_HEIGHT}" viewBox="0 0 ${VOUCHER_WIDTH} ${VOUCHER_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${bg2}"/>
      <stop offset="1" stop-color="${bg}"/>
    </linearGradient>
    <clipPath id="card"><rect width="${VOUCHER_WIDTH}" height="${VOUCHER_HEIGHT}" rx="34"/></clipPath>
  </defs>
  <rect width="${VOUCHER_WIDTH}" height="${VOUCHER_HEIGHT}" rx="34" fill="url(#bg)"/>
  <g clip-path="url(#card)">
  ${rays}
  <circle cx="1200" cy="0" r="420" fill="${gold}" opacity="0.06"/>
  <circle cx="1200" cy="0" r="250" fill="${gold}" opacity="0.06"/>
  </g>
  <rect x="30" y="30" width="${VOUCHER_WIDTH - 60}" height="${VOUCHER_HEIGHT - 60}" rx="22" fill="none" stroke="${gold}" stroke-opacity="0.45" stroke-width="2"/>
  <rect x="42" y="42" width="${VOUCHER_WIDTH - 84}" height="${VOUCHER_HEIGHT - 84}" rx="16" fill="none" stroke="${gold}" stroke-opacity="0.18" stroke-width="1"/>
  <text x="${LEFT}" y="118" fill="${gold}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="10">SPONSORSHIP VOUCHER</text>
  <text x="${LEFT}" y="188" fill="${cream}" opacity="0.78" font-family="Georgia, 'Times New Roman', serif" font-size="36" font-style="italic">Presented with our support to</text>
  ${nameSvg}
  ${cause ? `<text x="${LEFT}" y="428" fill="${cream}" opacity="0.72" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-style="italic">${cause}</text>` : ''}
  <rect x="812" y="84" width="292" height="92" rx="46" fill="${gold}"/>
  <text x="958" y="145" text-anchor="middle" fill="${bg}" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="800">${escapeSvg(input.amountLabel)}</text>
  <rect x="${LEFT}" y="470" width="470" height="80" rx="18" fill="${cream}" opacity="0.1" stroke="${gold}" stroke-opacity="0.5"/>
  <text x="${LEFT + 26}" y="521" fill="${cream}" font-family="Courier New, monospace" font-size="32" font-weight="700" letter-spacing="8">${escapeSvg(input.code)}</text>
  <text x="620" y="500" fill="${cream}" opacity="0.62" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" letter-spacing="6">DINE AT</text>
  <text x="620" y="538" fill="${cream}" font-family="Georgia, 'Times New Roman', serif" font-size="32" font-weight="700">${escapeSvg(input.venue)}</text>
  ${signature}
  <text x="${RIGHT}" y="640" text-anchor="end" fill="${cream}" opacity="0.62" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" letter-spacing="6">VALID UNTIL</text>
  <text x="${RIGHT}" y="678" text-anchor="end" fill="${cream}" font-family="Georgia, 'Times New Roman', serif" font-size="30" font-weight="700">${escapeSvg(input.expiryLabel)}</text>
  <text x="${LEFT}" y="722" fill="${cream}" opacity="0.6" font-family="Arial, Helvetica, sans-serif" font-size="17">${escapeSvg(input.conditions)}</text>
</svg>`;
}
