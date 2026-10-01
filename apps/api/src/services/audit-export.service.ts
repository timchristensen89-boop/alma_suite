import ExcelJS from 'exceljs';
import { renderAuditRunPdf } from '../lib/audit-pdf.js';
import { auditService } from './audit.service.js';

type Run = Awaited<ReturnType<typeof auditService.getRunById>>;

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export const auditExportService = {
  async pdf(runId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const run = (await auditService.getRunById(runId)) as Run;
    // Rendering lives in lib/audit-pdf.ts, where it is tested without a database.
    const bytes = await renderAuditRunPdf(run);
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
