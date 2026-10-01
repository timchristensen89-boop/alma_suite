import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * The audit run PDF (audit-export.service.ts), as a pure function of the run
 * so it is tested without a database.
 *
 * pdf-lib's standard fonts are WinAnsi-only: drawing a character outside that
 * set throws "WinAnsi cannot encode". The export drew a literal "→" before
 * every linked issue, so ANY audit with a finding linked to an issue failed
 * to export — and the same throw waited for emoji, a true minus or a narrow
 * no-break space typed into a finding on a phone. Every drawn string now goes
 * through pdfSafeText.
 */

// Windows-1252 characters above 0x7F that are not Latin-1 (0xA0-0xFF).
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/[→⇒➔➜]/g, '->'],
  [/[←⇐]/g, '<-'],
  [/−/g, '-'],
  [/≥/g, '>='],
  [/≤/g, '<='],
  [/[✓✔]/g, 'Yes'],
  [/[✗✘]/g, 'No'],
  [/[    ]/g, ' '],
  [/[​-‍⁠﻿︎️]/g, ''],
  [/[\t\r\n]+/g, ' ']
];

/** Text the standard fonts can draw: known symbols spelled out, accents dropped, anything else '?'. */
export function pdfSafeText(value: unknown): string {
  let text = String(value ?? '');
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement);
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(char)) {
      out += char;
      continue;
    }
    // "Māori" → "Maori": keep the base letter when there is one.
    const base = char.normalize('NFD').replace(/[̀-ͯ]/g, '');
    const baseCode = base.codePointAt(0) ?? 0;
    out += base.length === 1 && baseCode >= 0x20 && baseCode <= 0x7e ? base : '?';
  }
  return out;
}

export type AuditPdfIssue = {
  title?: string | null;
  status?: string | null;
  severity?: string | null;
  dueDate?: Date | string | null;
};

export type AuditPdfRun = {
  title: string;
  runDate: Date;
  score?: number | null;
  summary?: string | null;
  template: { name: string; sections: Array<{ title: string; description?: string | null }> };
  findings: Array<{ sectionTitle: string; finding: string; score?: number | null; linkedIssue?: AuditPdfIssue | null }>;
};

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function scoreColor(score: number | null | undefined) {
  if (score === null || score === undefined) return rgb(0.5, 0.5, 0.5);
  if (score < 50) return rgb(0.78, 0.17, 0.17);
  if (score < 75) return rgb(0.84, 0.54, 0.13);
  return rgb(0.17, 0.52, 0.27);
}

const titleCase = (value: string) => value.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** "Linked issue: Fridge seal torn · Open · High · due 2026-10-04", every part optional. */
export function linkedIssueLabel(issue: AuditPdfIssue): string {
  const due = issue.dueDate ? new Date(issue.dueDate) : null;
  const parts = [
    issue.title?.trim() || 'Untitled issue',
    issue.status ? titleCase(issue.status) : '',
    issue.severity ? titleCase(issue.severity) : '',
    due && !Number.isNaN(due.getTime()) ? `due ${formatDate(due)}` : ''
  ].filter(Boolean);
  return `Linked issue: ${parts.join(' · ')}`;
}

export async function renderAuditRunPdf(run: AuditPdfRun): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const PAGE_WIDTH = 595.28;
  const PAGE_HEIGHT = 841.89;
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]); // A4 portrait
  const width = PAGE_WIDTH;
  const height = PAGE_HEIGHT;
  const margin = 48;
  let y = height - margin;

  type DrawOptions = { bold?: boolean; color?: [number, number, number]; indent?: number };

  const drawLine = (text: string, size: number, opts: DrawOptions = {}) => {
    if (y < margin + size + 4) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = height - margin;
    }
    const { bold, color, indent = 0 } = opts;
    page.drawText(text, {
      x: margin + indent,
      y: y - size,
      size,
      font: bold ? fontBold : font,
      color: color ? rgb(color[0], color[1], color[2]) : rgb(0.1, 0.1, 0.1)
    });
    y -= size + 4;
  };

  // Wrapped to the page width, so long text runs onto new lines instead of
  // pdf-lib wrapping it inside one drawText and overprinting the next line.
  const draw = (text: string, size: number, opts: DrawOptions = {}) => {
    const fontToUse = opts.bold ? fontBold : font;
    const available = width - margin * 2 - (opts.indent ?? 0);
    const words = pdfSafeText(text).split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (fontToUse.widthOfTextAtSize(next, size) <= available || !current) {
        current = next;
      } else {
        drawLine(current, size, opts);
        current = word;
      }
    }
    if (current) drawLine(current, size, opts);
  };

  // Header
  draw(run.template.name, 11, { color: [0.4, 0.4, 0.4] });
  draw(run.title, 20, { bold: true });
  draw(`Run date: ${formatDate(run.runDate)}`, 10, { color: [0.4, 0.4, 0.4] });
  if (run.score !== null && run.score !== undefined) {
    const color = scoreColor(run.score);
    draw(`Score: ${run.score}%`, 14, { bold: true, color: [color.red, color.green, color.blue] });
  }
  y -= 8;

  if (run.summary) {
    draw('Summary', 12, { bold: true });
    draw(run.summary, 10);
    y -= 8;
  }

  const drawFinding = (finding: AuditPdfRun['findings'][number], prefix = '') => {
    const color = scoreColor(finding.score);
    draw(
      finding.score !== null && finding.score !== undefined
        ? `• ${prefix}[${finding.score}%] ${finding.finding.slice(0, 200)}`
        : `• ${prefix}${finding.finding.slice(0, 220)}`,
      9,
      { color: [color.red, color.green, color.blue] }
    );
    if (finding.linkedIssue) {
      draw(`-> ${linkedIssueLabel(finding.linkedIssue)}`, 8, { color: [0.3, 0.3, 0.7], indent: 12 });
    }
  };

  // Sections + their findings
  draw('Sections', 12, { bold: true });
  for (const section of run.template.sections) {
    const findings = run.findings.filter((f) => f.sectionTitle === section.title);
    draw(section.title, 11, { bold: true });
    if (section.description) draw(section.description, 9);
    if (findings.length === 0) {
      draw('No findings', 9, { color: [0.4, 0.5, 0.4] });
    } else {
      for (const finding of findings) drawFinding(finding);
    }
    y -= 4;
  }

  // Findings not attached to any known section (safety net)
  const orphanFindings = run.findings.filter((f) => !run.template.sections.some((s) => s.title === f.sectionTitle));
  if (orphanFindings.length > 0) {
    draw('Other findings', 11, { bold: true });
    for (const finding of orphanFindings) drawFinding(finding, `${finding.sectionTitle}: `);
  }

  return pdf.save();
}
