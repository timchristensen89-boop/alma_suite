import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { linkedIssueLabel, pdfSafeText, renderAuditRunPdf, type AuditPdfRun } from './audit-pdf.js';

const run = (findings: AuditPdfRun['findings'], extra: Partial<AuditPdfRun> = {}): AuditPdfRun => ({
  title: 'Kitchen audit — October',
  runDate: new Date('2026-10-01T00:00:00Z'),
  score: 82,
  summary: 'Mostly good.',
  template: { name: 'Food safety', sections: [{ title: 'Cold storage', description: 'Fridges and freezers' }] },
  findings,
  ...extra
});

const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.slice(0, 5)).toString('latin1') === '%PDF-';

describe('audit PDF export', () => {
  it('reproduces the crash: the standard font cannot draw the arrow the export used', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    assert.throws(() => font.encodeText('   → Linked issue: Fridge seal'), /WinAnsi cannot encode/);
  });

  it('exports a finding linked to an issue', async () => {
    const bytes = await renderAuditRunPdf(
      run([
        {
          sectionTitle: 'Cold storage',
          finding: 'Walk-in fridge seal torn',
          score: 40,
          linkedIssue: { title: 'Replace walk-in seal', status: 'IN_PROGRESS', severity: 'HIGH', dueDate: new Date('2026-10-04T00:00:00Z') }
        }
      ])
    );
    assert.ok(isPdf(bytes));
  });

  it('still exports findings with no linked issue', async () => {
    const bytes = await renderAuditRunPdf(run([{ sectionTitle: 'Cold storage', finding: 'All good', score: 100, linkedIssue: null }]));
    assert.ok(isPdf(bytes));
  });

  it('exports a linked issue with missing or partial fields', async () => {
    const bytes = await renderAuditRunPdf(
      run([
        { sectionTitle: 'Cold storage', finding: 'A', linkedIssue: { title: '' } },
        { sectionTitle: 'Cold storage', finding: 'B', linkedIssue: { title: null, status: null, severity: null, dueDate: 'not a date' } },
        { sectionTitle: 'Somewhere else', finding: 'Orphan finding', linkedIssue: { title: 'Orphan issue' } }
      ])
    );
    assert.ok(isPdf(bytes));
  });

  it('keeps the useful issue information', () => {
    assert.equal(
      linkedIssueLabel({ title: 'Replace walk-in seal', status: 'IN_PROGRESS', severity: 'HIGH', dueDate: new Date('2026-10-04T00:00:00Z') }),
      'Linked issue: Replace walk-in seal · In progress · High · due 2026-10-04'
    );
    assert.equal(linkedIssueLabel({ title: '  ' }), 'Linked issue: Untitled issue');
    assert.equal(linkedIssueLabel({ title: 'Seal', dueDate: 'garbage' }), 'Linked issue: Seal');
  });

  it('draws text typed on a phone: emoji, a true minus, narrow spaces, line breaks', async () => {
    const odd = 'Temp −2°C 😬 at 9 am\nchecked ✓ ≥ twice → logged, Māori';
    const bytes = await renderAuditRunPdf(
      run([{ sectionTitle: 'Cold storage', finding: odd, linkedIssue: { title: odd } }], { title: `Audit ${odd}`, summary: odd })
    );
    assert.ok(isPdf(bytes));
    assert.equal(pdfSafeText('a → b − c ✓ 😬 Māori'), 'a -> b - c Yes ? Maori');
  });

  it('runs long findings onto more pages instead of failing', async () => {
    const findings = Array.from({ length: 120 }, (_, i) => ({
      sectionTitle: 'Cold storage',
      finding: `Finding ${i} `.repeat(20),
      linkedIssue: i % 3 === 0 ? { title: `Issue ${i}` } : null
    }));
    const bytes = await renderAuditRunPdf(run(findings));
    assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
  });
});
