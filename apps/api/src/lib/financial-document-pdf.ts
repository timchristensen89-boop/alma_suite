// The printed form of a receipt, tax invoice or credit note.
//
// Pure: a FinancialDocumentDetail in, PDF bytes out. The database row is the
// record and this is only its rendering, so a document is re-rendered on
// demand and always says the same thing. Covered by
// financial-document-pdf.test.ts.
//
// pdf-lib's standard fonts can only encode WinAnsi (Windows-1252). One
// character outside it — a minus sign pasted into an address, an emoji in a
// purchaser's name, the narrow no-break space ICU puts before "pm" — throws
// and takes the whole document down with it. So every string drawn or
// measured goes through pdfSafeText first, and only single lines are ever
// measured (widthOfTextAtSize throws on a newline or a tab).

import { PDFDocument, StandardFonts, degrees, rgb, type Color, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import {
  centsToDollars,
  financialDocumentTitle,
  formatAbn,
  isCreditDocument,
  maskedGiftCardReference,
  type FinancialDocumentDetail,
  type PaymentProvider
} from '@alma/shared';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const RIGHT = PAGE_WIDTH - MARGIN;
// Content stops at the bottom margin; the page footer sits below it, so the
// two can never meet.
const CONTENT_FLOOR = MARGIN;
const FOOTER_BASELINE = 26;
const LEADING = 1.32;

const INK = rgb(0.122, 0.208, 0.141);
const MUTED = rgb(0.42, 0.47, 0.43);
const RULE = rgb(0.85, 0.83, 0.79);
const ALERT = rgb(0.7, 0.15, 0.18);
const WATERMARK = rgb(0.8, 0.8, 0.8);

const VOUCHER_NOTE =
  'GST is not charged on the issue of a face value voucher. GST is accounted for on taxable supplies when the voucher is redeemed.';
const FEE_NOTE =
  "The service fee is the amount paid above the card's face value, which is a taxable supply (s100-5(2) GST Act).";

const WIN_ANSI_SPECIALS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACEMENTS: Array<[RegExp, string]> = [
  [/−/g, '-'],
  [/→/g, '->'],
  [/≥/g, '>='],
  [/≤/g, '<='],
  [/✓/g, 'Yes'],
  [/[    ]/g, ' '],
  // Zero-width characters, plus the joiners and variation selectors inside
  // emoji sequences, which would otherwise each print as a stray "?".
  [/[​‌‍⁠﻿︎️]/g, ''],
  [/\t/g, ' ']
];

function isWinAnsi(char: string) {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_SPECIALS.has(char);
}

/**
 * The text as the standard PDF fonts can draw it. Anything they cannot is
 * replaced rather than allowed to throw. Newlines are replaced too: callers
 * that mean a line break split on it first (see wrapText).
 */
export function pdfSafeText(value: string): string {
  let text = String(value ?? '');
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  let safe = '';
  // for…of walks code points, so an emoji becomes one "?" rather than two.
  for (const char of text) {
    if (isWinAnsi(char)) {
      safe += char;
      continue;
    }
    // A letter carrying an accent WinAnsi lacks ("ā" in Māori) keeps its base
    // letter rather than turning a customer's name into question marks.
    const base = char.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    safe += base && [...base].every(isWinAnsi) ? base : '?';
  }
  return safe;
}

/**
 * Break text into lines no wider than `maxWidth`. Line breaks in the text are
 * kept; a single word wider than the column (an email address, a Stripe id)
 * is broken by character rather than allowed to run into the next column.
 */
function wrapText(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of String(value ?? '').split(/\r\n|\r|\n/)) {
    const words = pdfSafeText(paragraph).split(' ').filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      let rest = word;
      while (rest.length > 1 && font.widthOfTextAtSize(rest, size) > maxWidth) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    if (current) lines.push(current);
  }
  return lines;
}

// Date only, in Sydney: a time would bring ICU's U+202F before "am"/"pm".
const DATE_FORMAT = new Intl.DateTimeFormat('en-AU', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Australia/Sydney'
});

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null | undefined): string | null {
  const date = validDate(value);
  return date ? DATE_FORMAT.format(date) : null;
}

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  STRIPE: 'Stripe',
  CARD: 'Card',
  CASH: 'Cash',
  EFTPOS: 'EFTPOS',
  GIFTUP: 'GiftUp',
  OTHER: 'Other'
};

function paymentLabel(doc: FinancialDocumentDetail): string {
  const summary = doc.paymentMethodSummary?.trim();
  if (doc.paymentProvider === 'STRIPE') return summary && summary !== 'Stripe' ? `Stripe · ${summary}` : 'Stripe';
  return summary || PROVIDER_LABELS[doc.paymentProvider] || doc.paymentProvider;
}

function sourceLabel(doc: FinancialDocumentDetail): string | null {
  if (!doc.sourceReference) return null;
  // The code is the card's bearer secret; the document names it by its last
  // four. The full code stays on the row (sourceReference) for staff.
  return doc.sourceType === 'GIFT_CARD' ? `Gift card ${maskedGiftCardReference(doc.sourceReference)}` : doc.sourceReference;
}

const GIFT_CARD_CODE = /\bALMA-[A-Z0-9]{4,}\b/g;

/**
 * A line's text with any whole gift card code cut to "ending XXXX". Lines are
 * stored as issued, and documents issued before the lines named the card by
 * its last four still carry the full code ("ALMA gift card ALMA-22480BB1");
 * this keeps it off the printed copy without rewriting the record. Narrow on
 * purpose: only the ALMA-<code> shape, and only in line text.
 */
export function maskGiftCardCodes(text: string): string {
  return text.replace(GIFT_CARD_CODE, (code) => maskedGiftCardReference(code));
}

/**
 * Why the fee line carries GST. When a promo brings the voucher's price under
 * its face value, only the part of the fee that takes the total paid above
 * face value is taxable (s100-5(2)), so the note names that amount instead of
 * calling the whole fee taxable. Sale documents for gift cards only.
 */
export function feeNote(doc: FinancialDocumentDetail): string | null {
  if (isCreditDocument(doc.type) || doc.sourceType !== 'GIFT_CARD') return null;
  const taxable = doc.lines.find((line) => line.taxableAmountCents > 0);
  if (!taxable) return null;
  if (taxable.taxableAmountCents < taxable.amountCents) {
    return `The part of the service fee paid above the card's face value (${centsToDollars(taxable.taxableAmountCents)}) is a taxable supply (s100-5(2) GST Act).`;
  }
  return FEE_NOTE;
}

async function embedLogo(pdf: PDFDocument, png: Uint8Array | null | undefined): Promise<PDFImage | null> {
  if (!png || png.length === 0) return null;
  try {
    return await pdf.embedPng(png);
  } catch {
    // A damaged logo file must not stop a document printing.
    return null;
  }
}

function drawVoidMark(page: PDFPage, font: PDFFont) {
  const size = 150;
  const angle = 35;
  const radians = (angle * Math.PI) / 180;
  const width = font.widthOfTextAtSize('VOID', size);
  // pdf-lib rotates about the text's origin (its bottom-left corner), so step
  // back from the page centre along the rotated baseline to centre the word.
  const x = PAGE_WIDTH / 2 - (width / 2) * Math.cos(radians) + size * 0.35 * Math.sin(radians);
  const y = PAGE_HEIGHT / 2 - (width / 2) * Math.sin(radians) - size * 0.35 * Math.cos(radians);
  page.drawText('VOID', { x, y, size, font, color: WATERMARK, rotate: degrees(angle), opacity: 0.55 });
}

type Run = { text: string | null | undefined; size: number; bold?: boolean; color?: Color; gap?: number };
type Line = { text: string; size: number; font: PDFFont; color: Color; gap: number };

export type FinancialDocumentPdfOptions = {
  /** The ALMA wordmark as PNG bytes. Without it the header prints "ALMA" in type. */
  logoPng?: Uint8Array | null;
  /** Small print at the foot of the last page (e.g. who to contact). */
  footerLines?: string[];
};

export async function renderFinancialDocumentPdf(
  doc: FinancialDocumentDetail,
  options: FinancialDocumentPdfOptions = {}
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const title = financialDocumentTitle(doc.type);
  const isCredit = isCreditDocument(doc.type);
  const isVoid = doc.status === 'VOID';

  pdf.setTitle(pdfSafeText(`${title} ${doc.number}`));
  pdf.setAuthor(pdfSafeText(doc.issuerLegalName));
  pdf.setCreator('Alma Suite');
  pdf.setProducer('Alma Suite');
  // Dated from the document, not the render, so the same row prints the same file.
  const issuedAt = validDate(doc.issuedAt);
  if (issuedAt) {
    pdf.setCreationDate(issuedAt);
    pdf.setModificationDate(issuedAt);
  }

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedLogo(pdf, options.logoPng);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    // First, so it sits under everything drawn on the page after it.
    if (isVoid) drawVoidMark(page, bold);
    y = PAGE_HEIGHT - MARGIN;
  };

  /** Start a new page unless `height` still fits above the floor. */
  const ensure = (height: number, onNewPage?: () => void) => {
    if (y - height >= CONTENT_FLOOR) return;
    newPage();
    onNewPage?.();
  };

  const layout = (runs: Array<Run | null | false>, width: number): Line[] =>
    runs
      .filter((run): run is Run & { text: string } => Boolean(run && run.text && run.text.trim()))
      .flatMap((run) => {
        const font = run.bold ? bold : regular;
        return wrapText(run.text, font, run.size, width).map((text, index) => ({
          text,
          size: run.size,
          font,
          color: run.color ?? INK,
          gap: index === 0 ? run.gap ?? 0 : 0
        }));
      });

  const heightOf = (lines: Line[]) => lines.reduce((sum, line) => sum + line.gap + line.size * LEADING, 0);

  /** Draw laid-out lines downward from `top`; `x` is the right edge when right-aligned. */
  const drawLines = (lines: Line[], x: number, top: number, align: 'left' | 'right' = 'left') => {
    let cursor = top;
    for (const line of lines) {
      cursor -= line.gap;
      const width = line.font.widthOfTextAtSize(line.text, line.size);
      page.drawText(line.text, {
        x: align === 'right' ? x - width : x,
        y: cursor - line.size,
        size: line.size,
        font: line.font,
        color: line.color
      });
      cursor -= line.size * LEADING;
    }
  };

  /** One single-line string, right edge at `right`. */
  const putRight = (value: string, right: number, baseline: number, size: number, font: PDFFont, color: Color) => {
    const text = pdfSafeText(value);
    page.drawText(text, { x: right - font.widthOfTextAtSize(text, size), y: baseline, size, font, color });
  };

  const rule = (color: Color = RULE, thickness = 0.6) => {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: RIGHT, y }, thickness, color });
  };

  newPage();

  /* Header: wordmark left, what this is and its number right. */
  const headerTop = y;
  let brandHeight: number;
  if (logo) {
    const width = 116;
    brandHeight = (width * logo.height) / logo.width;
    page.drawImage(logo, { x: MARGIN, y: headerTop - brandHeight, width, height: brandHeight });
  } else {
    page.drawText(pdfSafeText('ALMA'), { x: MARGIN, y: headerTop - 26, size: 30, font: bold, color: INK });
    brandHeight = 32;
  }
  const status: Run | null = isVoid
    ? { text: `VOID — ${doc.voidReason?.trim() || 'no reason recorded'}`, size: 10, bold: true, color: ALERT, gap: 6 }
    : isCredit
      ? { text: 'CREDITED', size: 10, bold: true, gap: 6 }
      : doc.paidAt
        ? { text: 'PAID', size: 10, bold: true, gap: 6 }
        : null;
  const headerLines = layout(
    [
      { text: title.toUpperCase(), size: 16, bold: true },
      { text: doc.number, size: 11, bold: true, gap: 3 },
      { text: `Issued ${formatDate(doc.issuedAt) ?? ''}`, size: 9, color: MUTED, gap: 2 },
      status,
      doc.testMode ? { text: 'TEST DOCUMENT — not a real sale', size: 8, bold: true, color: ALERT, gap: 3 } : null
    ],
    CONTENT_WIDTH - 150
  );
  drawLines(headerLines, RIGHT, headerTop, 'right');
  y = headerTop - Math.max(brandHeight, heightOf(headerLines)) - 14;
  rule();
  y -= 18;

  /* Who it is from and who it is for, side by side. */
  const columnGap = 28;
  const columnWidth = (CONTENT_WIDTH - columnGap) / 2;
  const contact = [doc.issuerEmail, doc.issuerPhone, doc.issuerWebsite]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(' · ');
  const fromLines = layout(
    [
      { text: 'FROM', size: 7.5, bold: true, color: MUTED },
      { text: doc.issuerLegalName, size: 10.5, bold: true, gap: 3 },
      doc.issuerTradingName ? { text: `Trading as ${doc.issuerTradingName}`, size: 9 } : null,
      { text: `ABN ${formatAbn(doc.issuerAbn)}`, size: 9 },
      { text: doc.issuerAddress, size: 9, color: MUTED },
      { text: contact, size: 9, color: MUTED }
    ],
    columnWidth
  );
  const organisation = doc.customerOrganisation?.trim();
  const customerName = doc.customerName.trim();
  const billLines = layout(
    [
      { text: 'BILL TO', size: 7.5, bold: true, color: MUTED },
      organisation ? { text: organisation, size: 10.5, bold: true, gap: 3 } : null,
      organisation
        ? { text: customerName, size: 9 }
        : { text: customerName || doc.customerEmail || 'Customer', size: 10.5, bold: true, gap: 3 },
      doc.customerAbn ? { text: `ABN ${formatAbn(doc.customerAbn)}`, size: 9 } : null,
      customerName || organisation ? { text: doc.customerEmail, size: 9, color: MUTED } : null,
      doc.customerReference ? { text: `Your reference: ${doc.customerReference}`, size: 9 } : null
    ],
    columnWidth
  );
  const partiesHeight = Math.max(heightOf(fromLines), heightOf(billLines));
  ensure(partiesHeight);
  drawLines(fromLines, MARGIN, y);
  drawLines(billLines, MARGIN + columnWidth + columnGap, y);
  y -= partiesHeight + 18;

  /* Details: dates, what it was for, how the money moved. */
  const labelWidth = 118;
  const detailRows: Array<{ label: string; value: string | null | undefined; small?: boolean }> = [
    { label: 'Date of issue', value: formatDate(doc.issuedAt) },
    { label: isCredit ? 'Date refunded' : 'Date paid', value: formatDate(doc.paidAt) },
    { label: 'For', value: sourceLabel(doc) },
    { label: isCredit ? 'Refund method' : 'Payment', value: paymentLabel(doc) },
    { label: 'Reference', value: doc.paymentReference },
    { label: 'Credits', value: isCredit ? doc.creditsDocumentNumber : null },
    { label: 'Reason', value: isCredit ? doc.reason : null },
    { label: 'Voided', value: isVoid ? formatDate(doc.voidedAt) : null },
    { label: 'Stripe payment', value: doc.stripePaymentIntentId, small: true },
    { label: 'Stripe refund', value: doc.stripeRefundId, small: true }
  ];
  for (const row of detailRows) {
    if (!row.value?.trim()) continue;
    const size = row.small ? 7.5 : 9;
    const labelLines = layout([{ text: row.label, size, color: MUTED }], labelWidth - 10);
    const valueLines = layout([{ text: row.value, size, color: row.small ? MUTED : INK }], CONTENT_WIDTH - labelWidth);
    const height = Math.max(heightOf(labelLines), heightOf(valueLines)) + 2;
    ensure(height);
    drawLines(labelLines, MARGIN, y);
    drawLines(valueLines, MARGIN + labelWidth, y);
    y -= height;
  }
  y -= 16;

  /* Lines: description | GST | amount, header repeated on every page. */
  const cellGap = 14;
  const amountWidth = 96;
  const gstWidth = 84;
  const gstRight = RIGHT - amountWidth - cellGap;
  const descriptionWidth = CONTENT_WIDTH - amountWidth - gstWidth - cellGap * 2;
  const tableHeader = () => {
    const size = 7.5;
    const baseline = y - size;
    page.drawText(pdfSafeText('DESCRIPTION'), { x: MARGIN, y: baseline, size, font: bold, color: MUTED });
    putRight('GST', gstRight, baseline, size, bold, MUTED);
    putRight('AMOUNT (INCL. GST)', RIGHT, baseline, size, bold, MUTED);
    y -= size * LEADING + 4;
    rule(INK, 0.8);
    y -= 7;
  };
  ensure(60);
  tableHeader();
  for (const line of doc.lines) {
    const taxable = line.taxableAmountCents !== 0;
    const partlyTaxable = taxable && line.taxableAmountCents !== line.amountCents;
    const detail = [
      line.detail && maskGiftCardCodes(line.detail),
      line.quantity > 1 ? `${line.quantity} × ${centsToDollars(line.unitAmountCents)}` : null
    ]
      .filter(Boolean)
      .join(' · ');
    const descriptionLines = layout(
      [
        { text: `${maskGiftCardCodes(line.description)}${taxable ? ' *' : ''}`, size: 9.5, bold: true },
        { text: detail, size: 8, color: MUTED, gap: 1 }
      ],
      descriptionWidth
    );
    const gstLines = layout(
      [
        { text: taxable ? centsToDollars(line.gstCents) : 'No GST', size: 9, color: taxable ? INK : MUTED },
        partlyTaxable ? { text: `on ${centsToDollars(line.taxableAmountCents)}`, size: 7.5, color: MUTED, gap: 1 } : null
      ],
      gstWidth
    );
    const amountLines = layout([{ text: centsToDollars(line.amountCents), size: 9.5 }], amountWidth);
    const height = Math.max(heightOf(descriptionLines), heightOf(gstLines), heightOf(amountLines)) + 6;
    ensure(height + 7, tableHeader);
    drawLines(descriptionLines, MARGIN, y);
    drawLines(gstLines, gstRight, y, 'right');
    drawLines(amountLines, RIGHT, y, 'right');
    y -= height;
    rule();
    y -= 7;
  }
  if (doc.lines.some((line) => line.taxableAmountCents !== 0)) {
    ensure(12);
    page.drawText(pdfSafeText('* Taxable supply'), { x: MARGIN, y: y - 8, size: 8, font: regular, color: MUTED });
    y -= 14;
  }

  /* Totals, kept together on one page. */
  const totals: Array<{ label: string; cents: number; strong?: boolean }> = isCredit
    ? [
        { label: 'Total credited', cents: doc.totalCents, strong: true },
        { label: 'GST adjustment', cents: doc.gstCents }
      ]
    : doc.type === 'TAX_INVOICE'
      ? [
          { label: 'Total (incl. GST)', cents: doc.totalCents, strong: true },
          { label: 'GST included', cents: doc.gstCents },
          { label: 'Taxable supplies (incl. GST)', cents: doc.taxableCents }
        ]
      : [
          { label: 'Total paid', cents: doc.totalCents, strong: true },
          { label: 'GST', cents: doc.gstCents }
        ];
  const totalsHeight = totals.reduce((sum, row) => sum + (row.strong ? 12 : 9.5) * LEADING + 3, 0) + 7.5 * LEADING;
  y -= 8;
  ensure(totalsHeight);
  for (const row of totals) {
    const size = row.strong ? 12 : 9.5;
    const font = row.strong ? bold : regular;
    putRight(row.label, RIGHT - 120, y - size, size, font, row.strong ? INK : MUTED);
    putRight(centsToDollars(row.cents), RIGHT, y - size, size, font, INK);
    y -= size * LEADING + 3;
  }
  putRight(`All amounts in ${(doc.currency || 'aud').toUpperCase()}`, RIGHT, y - 7.5, 7.5, regular, MUTED);
  y -= 7.5 * LEADING + 20;

  /* Notes: why the GST reads the way it does, and anything the buyer asked for. */
  const notes = [
    doc.lines.some((line) => line.gstTreatment === 'FACE_VALUE_VOUCHER') ? VOUCHER_NOTE : null,
    feeNote(doc),
    doc.note
  ].filter((note): note is string => Boolean(note?.trim()));
  if (notes.length > 0) {
    const label = layout([{ text: 'NOTES', size: 7.5, bold: true, color: MUTED }], CONTENT_WIDTH);
    ensure(heightOf(label) + 8.5 * LEADING * 2);
    drawLines(label, MARGIN, y);
    y -= heightOf(label) + 2;
    for (const note of notes) {
      for (const line of layout([{ text: note, size: 8.5 }], CONTENT_WIDTH)) {
        const height = heightOf([line]);
        ensure(height);
        drawLines([line], MARGIN, y);
        y -= height;
      }
      y -= 5;
    }
  }

  /* Small print, anchored to the foot of the last page. */
  const footer = layout(
    (options.footerLines ?? []).map((text) => ({ text, size: 7.5, color: MUTED })),
    CONTENT_WIDTH
  );
  if (footer.length > 0) {
    const height = heightOf(footer);
    if (y - height - 12 < CONTENT_FLOOR) newPage();
    drawLines(footer, MARGIN, CONTENT_FLOOR + height);
  }

  pages.forEach((target, index) => {
    const label = pdfSafeText(`Page ${index + 1} of ${pages.length} · ${doc.number}`);
    const width = regular.widthOfTextAtSize(label, 7.5);
    target.drawText(label, { x: (PAGE_WIDTH - width) / 2, y: FOOTER_BASELINE, size: 7.5, font: regular, color: MUTED });
  });

  return pdf.save();
}
