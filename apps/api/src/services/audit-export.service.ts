import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { auditService } from './audit.service.js';

type Run = Awaited<ReturnType<typeof auditService.getRunById>>;

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function scoreColor(score: number | null | undefined) {
  if (score === null || score === undefined) return rgb(0.5, 0.5, 0.5);
  if (score < 50) return rgb(0.78, 0.17, 0.17);
  if (score < 75) return rgb(0.84, 0.54, 0.13);
  return rgb(0.17, 0.52, 0.27);
}

export const auditExportService = {
  async pdf(runId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const run = (await auditService.getRunById(runId)) as Run;

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

    const draw = (text: string, size: number, opts: { bold?: boolean; color?: [number, number, number] } = {}) => {
      if (y < margin + size + 4) {
        page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = height - margin;
      }
      const { bold, color } = opts;
      page.drawText(text, {
        x: margin,
        y: y - size,
        size,
        font: bold ? fontBold : font,
        color: color ? rgb(color[0], color[1], color[2]) : rgb(0.1, 0.1, 0.1),
        maxWidth: width - margin * 2
      });
      y -= size + 4;
    };

    const wrap = (text: string, size: number, fontToUse = font): string[] => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (fontToUse.widthOfTextAtSize(next, size) <= width - margin * 2) {
          current = next;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines;
    };

    const paragraph = (text: string, size: number, bold = false) => {
      for (const line of wrap(text, size, bold ? fontBold : font)) {
        draw(line, size, { bold });
      }
    };

    // Header
    draw(run.template.name, 11, { bold: false, color: [0.4, 0.4, 0.4] });
    draw(run.title, 20, { bold: true });
    draw(`Run date: ${formatDate(run.runDate)}`, 10, { color: [0.4, 0.4, 0.4] });
    if (run.score !== null && run.score !== undefined) {
      const [r, g, b] = [scoreColor(run.score).red, scoreColor(run.score).green, scoreColor(run.score).blue];
      draw(`Score: ${run.score}%`, 14, { bold: true, color: [r, g, b] });
    }
    y -= 8;

    if (run.summary) {
      draw('Summary', 12, { bold: true });
      paragraph(run.summary, 10);
      y -= 8;
    }

    // Sections + their findings
    draw('Sections', 12, { bold: true });
    for (const section of run.template.sections) {
      const findings = run.findings.filter((f) => f.sectionTitle === section.title);

      draw(section.title, 11, { bold: true });
      if (section.description) paragraph(section.description, 9, false);
      if (findings.length === 0) {
        draw('No findings', 9, { color: [0.4, 0.5, 0.4] });
      } else {
        for (const finding of findings) {
          const color = scoreColor(finding.score);
          draw(
            finding.score !== null && finding.score !== undefined
              ? `• [${finding.score}%] ${finding.finding.slice(0, 200)}`
              : `• ${finding.finding.slice(0, 220)}`,
            9,
            { color: [color.red, color.green, color.blue] }
          );
          if (finding.linkedIssue) {
            draw(`   → Linked issue: ${finding.linkedIssue.title}`, 8, {
              color: [0.3, 0.3, 0.7]
            });
          }
        }
      }
      y -= 4;
    }

    // Findings not attached to any known section (safety net)
    const orphanFindings = run.findings.filter(
      (f) => !run.template.sections.some((s) => s.title === f.sectionTitle)
    );
    if (orphanFindings.length > 0) {
      draw('Other findings', 11, { bold: true });
      for (const f of orphanFindings) {
        draw(`• ${f.sectionTitle}: ${f.finding.slice(0, 200)}`, 9);
      }
    }

    const bytes = await pdf.save();
    return {
      filename: `audit-${run.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`,
      bytes
    };
  },

  async xlsx(runId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const run = (await auditService.getRunById(runId)) as Run;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Alma Suite';

    // Summary sheet
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Field', key: 'field', width: 24 },
      { header: 'Value', key: 'value', width: 60 }
    ];
    summary.getRow(1).font = { bold: true };
    summary.addRows([
      { field: 'Template', value: run.template.name },
      { field: 'Run title', value: run.title },
      { field: 'Run date', value: formatDate(run.runDate) },
      { field: 'Score', value: run.score ?? '' },
      { field: 'Summary', value: run.summary ?? '' },
      { field: 'Findings', value: run.findings.length }
    ]);

    // Findings sheet
    const findings = workbook.addWorksheet('Findings');
    findings.columns = [
      { header: 'Section', key: 'section', width: 34 },
      { header: 'Finding', key: 'finding', width: 60 },
      { header: 'Score', key: 'score', width: 10 },
      { header: 'Linked issue', key: 'issue', width: 40 }
    ];
    findings.getRow(1).font = { bold: true };
    for (const f of run.findings) {
      findings.addRow({
        section: f.sectionTitle,
        finding: f.finding,
        score: f.score ?? '',
        issue: f.linkedIssue?.title ?? ''
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `audit-${run.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xlsx`,
      bytes: new Uint8Array(buffer as ArrayBuffer)
    };
  }
};
