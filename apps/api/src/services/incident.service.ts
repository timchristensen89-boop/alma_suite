import { prisma } from '@alma/db';
import { incidentCreateInputSchema, incidentUpdateInputSchema } from '@alma/shared';
import { HttpError } from '../lib/http.js';

export const incidentService = {
  async list() {
    return prisma.incidentReport.findMany({
      orderBy: [{ occurredAt: 'desc' }],
      include: {
        people: true,
        linkedIssue: true
      }
    });
  },

  async getById(id: string) {
    const incident = await prisma.incidentReport.findUnique({
      where: { id },
      include: {
        people: true,
        linkedIssue: true
      }
    });

    if (!incident) {
      throw new HttpError(404, 'Incident report not found');
    }

    return incident;
  },

  async create(input: unknown) {
    const data = incidentCreateInputSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      let linkedIssueId: string | null = null;

      if (data.createIssue) {
        const issue = await tx.issue.create({
          data: {
            title: data.title,
            description: data.summary,
            severity: data.severity,
            category: 'Incident',
            status: 'OPEN',
            assignee: null,
            dueDate: null,
            notes: `Auto-created from incident report at ${data.location || data.venue || 'unknown location'}.`,
            activities: {
              create: {
                action: 'created',
                message: 'Issue created from incident report.',
                actor: 'system'
              }
            }
          }
        });

        linkedIssueId = issue.id;
      }

      return tx.incidentReport.create({
        data: {
          title: data.title,
          incidentType: data.incidentType,
          severity: data.severity,
          status: data.status,
          occurredAt: new Date(data.occurredAt),
          reportedBy: data.reportedBy,
          venue: data.venue || null,
          location: data.location || null,
          summary: data.summary,
          immediateActions: data.immediateActions || null,
          treatmentProvided: data.treatmentProvided || null,
          followUpRequired: Boolean(data.followUpRequired),
          followUpNotes: data.followUpNotes || null,
          linkedIssueId,
          people: data.people?.length
            ? {
                create: data.people.map((person) => ({
                  name: person.name,
                  role: person.role,
                  involvement: person.involvement,
                  contactDetails: person.contactDetails || null,
                  injuryDetails: person.injuryDetails || null,
                  witnessStatement: person.witnessStatement || null
                }))
              }
            : undefined
        },
        include: {
          people: true,
          linkedIssue: true
        }
      });
    });
  },

  async update(id: string, input: unknown) {
    await this.getById(id);
    const data = incidentUpdateInputSchema.parse(input);

    const patch: Record<string, unknown> = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.severity !== undefined) patch.severity = data.severity;
    if (data.immediateActions !== undefined) patch.immediateActions = data.immediateActions || null;
    if (data.treatmentProvided !== undefined) patch.treatmentProvided = data.treatmentProvided || null;
    if (data.followUpRequired !== undefined) patch.followUpRequired = Boolean(data.followUpRequired);
    if (data.followUpNotes !== undefined) patch.followUpNotes = data.followUpNotes || null;

    return prisma.incidentReport.update({
      where: { id },
      data: patch,
      include: {
        people: true,
        linkedIssue: true
      }
    });
  },

  async summary() {
    const [total, open, followUpRequired, critical] = await Promise.all([
      prisma.incidentReport.count(),
      prisma.incidentReport.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      prisma.incidentReport.count({ where: { followUpRequired: true, status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      prisma.incidentReport.count({ where: { severity: 'CRITICAL', status: { in: ['OPEN', 'UNDER_REVIEW'] } } })
    ]);

    return { total, open, followUpRequired, critical };
  }
};
