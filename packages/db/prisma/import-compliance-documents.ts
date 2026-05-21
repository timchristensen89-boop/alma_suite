import { Prisma } from '@prisma/client';
import {
  ALMA_COMPLIANCE_DOCUMENTS,
  ALMA_IMPORTED_CHECKLIST_TEMPLATES
} from '@alma/shared';
import { prisma } from '../src/prisma.js';

const SETTINGS_ID = 'singleton';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

async function importChecklistTemplates() {
  for (const template of ALMA_IMPORTED_CHECKLIST_TEMPLATES) {
    const existing = await prisma.checklistTemplate.findFirst({
      where: { name: template.name },
      include: { items: true }
    });

    if (!existing) {
      await prisma.checklistTemplate.create({
        data: {
          name: template.name,
          area: template.area,
          items: {
            create: template.items.map(([label, description], index) => ({
              label,
              description: template.reviewStatus === 'active'
                ? description
                : `${description} Needs manager review before active use.`,
              position: index
            }))
          }
        }
      });
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.checklistTemplate.update({
        where: { id: existing.id },
        data: { area: template.area }
      });

      await tx.checklistItemTemplate.deleteMany({
        where: { templateId: existing.id }
      });

      await tx.checklistItemTemplate.createMany({
        data: template.items.map(([label, description], index) => ({
          templateId: existing.id,
          label,
          description: template.reviewStatus === 'active'
            ? description
            : `${description} Needs manager review before active use.`,
          position: index
        }))
      });
    });
  }
}

async function importDocumentRegister() {
  const settings = await prisma.appSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID }
  });

  const handbookContent = asObject(settings.handbookContent);
  handbookContent.importedDocumentRegister = ALMA_COMPLIANCE_DOCUMENTS;
  handbookContent.importedDocumentRegisterUpdatedAt = new Date().toISOString();

  await prisma.appSettings.update({
    where: { id: SETTINGS_ID },
    data: {
      handbookContent: handbookContent as Prisma.InputJsonValue
    }
  });
}

async function main() {
  await importChecklistTemplates();
  await importDocumentRegister();
  console.log(
    `Imported ${ALMA_IMPORTED_CHECKLIST_TEMPLATES.length} checklist templates and ${ALMA_COMPLIANCE_DOCUMENTS.length} document register entries.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
