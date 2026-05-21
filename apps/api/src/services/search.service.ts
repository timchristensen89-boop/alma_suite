import { prisma } from '@alma/db';

export type SearchResult = {
  id: string;
  type: 'issue' | 'staff' | 'asset' | 'checklist' | 'audit' | 'incident';
  title: string;
  subtitle: string;
  to: string;
};

export const searchService = {
  async search(q: string): Promise<SearchResult[]> {
    const query = q.trim();
    if (!query) return [];
    const results: SearchResult[] = [];

    const [issues, staff, assets, checklistRuns, auditRuns, incidents] = await Promise.all([
      prisma.issue.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
            { category: { contains: query, mode: 'insensitive' } }
          ]
        },
        take: 5,
        orderBy: { updatedAt: 'desc' }
      }),
      prisma.staffProfile.findMany({
        where: {
          accountType: 'HUMAN',
          employmentStatus: { not: 'ARCHIVED' },
          mergedIntoStaffProfileId: null,
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { roleTitle: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } }
          ]
        },
        take: 5,
        orderBy: { lastName: 'asc' }
      }),
      prisma.temperatureAsset.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { venue: { contains: query, mode: 'insensitive' } },
            { area: { contains: query, mode: 'insensitive' } }
          ]
        },
        take: 5
      }),
      prisma.checklistRun.findMany({
        where: {
          OR: [
            { area: { contains: query, mode: 'insensitive' } },
            { performedBy: { contains: query, mode: 'insensitive' } },
            { template: { name: { contains: query, mode: 'insensitive' } } }
          ]
        },
        take: 5,
        include: { template: true },
        orderBy: { runDate: 'desc' }
      }),
      prisma.auditRun.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { summary: { contains: query, mode: 'insensitive' } }
          ]
        },
        take: 5,
        orderBy: { runDate: 'desc' }
      }),
      prisma.incidentReport.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { summary: { contains: query, mode: 'insensitive' } },
            { incidentType: { contains: query, mode: 'insensitive' } }
          ]
        },
        take: 5,
        orderBy: { occurredAt: 'desc' }
      })
    ]);

    for (const issue of issues) {
      results.push({
        id: issue.id,
        type: 'issue',
        title: issue.title,
        subtitle: `${issue.severity} · ${issue.status}${issue.assignee ? ` · ${issue.assignee}` : ''}`,
        to: `/issues/${issue.id}`
      });
    }

    for (const profile of staff) {
      results.push({
        id: profile.id,
        type: 'staff',
        title: `${profile.firstName} ${profile.lastName}`,
        subtitle: [profile.roleTitle, profile.venue].filter(Boolean).join(' · '),
        to: '/staff'
      });
    }

    for (const asset of assets) {
      results.push({
        id: asset.id,
        type: 'asset',
        title: asset.name,
        subtitle: [asset.venue, asset.area, asset.assetType].filter(Boolean).join(' · '),
        to: '/temperatures'
      });
    }

    for (const run of checklistRuns) {
      results.push({
        id: run.id,
        type: 'checklist',
        title: run.template.name,
        subtitle: `${run.status} · ${run.runDate.toISOString().slice(0, 10)}${run.performedBy ? ` · ${run.performedBy}` : ''}`,
        to: `/checklists/runs/${run.id}`
      });
    }

    for (const run of auditRuns) {
      results.push({
        id: run.id,
        type: 'audit',
        title: run.title,
        subtitle: `Audit · ${run.runDate.toISOString().slice(0, 10)}${run.score !== null ? ` · ${run.score}%` : ''}`,
        to: `/audits/${run.id}`
      });
    }

    for (const incident of incidents) {
      results.push({
        id: incident.id,
        type: 'incident',
        title: incident.title,
        subtitle: `${incident.incidentType} · ${incident.severity} · ${incident.status}`,
        to: '/incidents'
      });
    }

    return results;
  }
};
