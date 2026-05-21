import { prisma } from '../src/prisma.js';
import { cleanImportedChecklistAuditText } from './compliance-import.js';

type CleanupResult = {
  checklistItemTemplates: number;
  checklistRuns: number;
  checklistItems: number;
  auditTemplateSections: number;
  auditRuns: number;
  auditFindings: number;
};

async function cleanRecordText<T extends { id: string }>(
  records: T[],
  getValue: (record: T) => string | null,
  update: (id: string, value: string | null) => Promise<unknown>
) {
  let count = 0;

  for (const record of records) {
    const current = getValue(record);
    const cleaned = cleanImportedChecklistAuditText(current);
    if (cleaned === current) continue;
    await update(record.id, cleaned);
    count += 1;
  }

  return count;
}

async function main() {
  const result: CleanupResult = {
    checklistItemTemplates: 0,
    checklistRuns: 0,
    checklistItems: 0,
    auditTemplateSections: 0,
    auditRuns: 0,
    auditFindings: 0
  };

  result.checklistItemTemplates = await cleanRecordText(
    await prisma.checklistItemTemplate.findMany({
      select: { id: true, description: true }
    }),
    (record) => record.description,
    (id, description) => prisma.checklistItemTemplate.update({ where: { id }, data: { description } })
  );

  result.checklistRuns = await cleanRecordText(
    await prisma.checklistRun.findMany({
      select: { id: true, notes: true }
    }),
    (record) => record.notes,
    (id, notes) => prisma.checklistRun.update({ where: { id }, data: { notes } })
  );

  for (const record of await prisma.checklistItem.findMany({
    select: { id: true, description: true, notes: true }
  })) {
    const description = cleanImportedChecklistAuditText(record.description);
    const notes = cleanImportedChecklistAuditText(record.notes);
    if (description === record.description && notes === record.notes) continue;
    await prisma.checklistItem.update({
      where: { id: record.id },
      data: { description, notes }
    });
    result.checklistItems += 1;
  }

  result.auditTemplateSections = await cleanRecordText(
    await prisma.auditTemplateSection.findMany({
      select: { id: true, description: true }
    }),
    (record) => record.description,
    (id, description) => prisma.auditTemplateSection.update({ where: { id }, data: { description } })
  );

  result.auditRuns = await cleanRecordText(
    await prisma.auditRun.findMany({
      select: { id: true, summary: true }
    }),
    (record) => record.summary,
    (id, summary) => prisma.auditRun.update({ where: { id }, data: { summary } })
  );

  result.auditFindings = await cleanRecordText(
    await prisma.auditFinding.findMany({
      select: { id: true, finding: true }
    }),
    (record) => record.finding,
    (id, finding) => prisma.auditFinding.update({ where: { id }, data: { finding: finding || 'Audit finding' } })
  );

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
