// Phase 5.11: Task reconciliation — the first AlmaTask emitters.
//
// Rather than scatter createTaskFromSource() calls across every write
// path in the suite, this service derives the canonical "what's
// outstanding" set from current data — the same shape the notifications
// service already uses. It's idempotent (createTaskFromSource dedupes
// by source ref) and self-healing: when a source object stops
// qualifying (issue resolved, leave approved), its task is auto-closed.
//
// Sources wired in this first pass:
//   - Compliance: critical (unresolved) issues      → priority CRITICAL
//   - Compliance: overdue (unresolved) issues        → priority TODAY
//   - Staff: pending leave requests                   → priority TODAY
//
// More sources (gift-card fulfilment, stock missing counts, integration
// health) follow the same add-a-reconciler pattern.

import { prisma } from '@alma/db';
import { createTaskFromSource, resolveTasksFromSource } from './alma-tasks.service.js';

const OPEN_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED'] as const;

// In-memory throttle so a burst of 60s polls from multiple devices
// doesn't reconcile on every single request. Forced syncs bypass it.
let lastReconcileAt = 0;
const RECONCILE_MIN_INTERVAL_MS = 30_000;

// Resolved tasks (DONE/DISMISSED) older than this are deleted so the table
// doesn't grow without bound. Source-reconciled tasks resurrect on their own
// unique key if the condition recurs, so deleting old closed ones is safe.
const PRUNE_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

async function pruneResolvedTasks(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - PRUNE_AFTER_MS);
  await prisma.almaTask.deleteMany({
    where: {
      status: { in: ['DONE', 'DISMISSED'] },
      updatedAt: { lt: cutoff }
    }
  });
}

async function reconcileIssues(now: Date): Promise<void> {
  const issues = await prisma.issue.findMany({
    where: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
    select: { id: true, title: true, description: true, severity: true, dueDate: true, area: true },
    take: 300
  });

  const qualifying = new Set<string>();
  for (const issue of issues) {
    const isCritical = issue.severity === 'CRITICAL';
    const isOverdue = Boolean(issue.dueDate && issue.dueDate < now);
    if (!isCritical && !isOverdue) continue;
    qualifying.add(issue.id);
    await createTaskFromSource({
      sourceApp: 'COMPLIANCE',
      sourceRefType: 'issue',
      sourceRefId: issue.id,
      venue: null, // issues aren't venue-scoped — suite-wide concern
      title: isCritical ? `Critical issue: ${issue.title}` : `Overdue issue: ${issue.title}`,
      description: issue.area ? `Area: ${issue.area}` : issue.description?.slice(0, 140) ?? null,
      priority: isCritical ? 'CRITICAL' : 'TODAY'
    });
  }

  // Close issue-tasks whose issue no longer qualifies (resolved, or no
  // longer critical/overdue).
  const openIssueTasks = await prisma.almaTask.findMany({
    where: { sourceApp: 'COMPLIANCE', sourceRefType: 'issue', status: { in: [...OPEN_STATUSES] } },
    select: { sourceRefId: true }
  });
  for (const task of openIssueTasks) {
    if (task.sourceRefId && !qualifying.has(task.sourceRefId)) {
      await resolveTasksFromSource('COMPLIANCE', 'issue', task.sourceRefId);
    }
  }
}

async function reconcileLeave(): Promise<void> {
  const pending = await prisma.staffLeaveRequest.findMany({
    where: { status: 'PENDING' },
    select: {
      id: true,
      type: true,
      startDate: true,
      endDate: true,
      staffProfile: { select: { firstName: true, lastName: true, venue: true } }
    },
    take: 300
  });

  const qualifying = new Set<string>();
  for (const leave of pending) {
    qualifying.add(leave.id);
    const name = `${leave.staffProfile.firstName} ${leave.staffProfile.lastName}`.trim() || 'Staff member';
    await createTaskFromSource({
      sourceApp: 'STAFF',
      sourceRefType: 'leave',
      sourceRefId: leave.id,
      venue: leave.staffProfile.venue ?? null,
      title: `Approve leave: ${name}`,
      description: `${leave.type} · ${leave.startDate.toISOString().slice(0, 10)} → ${leave.endDate
        .toISOString()
        .slice(0, 10)}`,
      priority: 'TODAY'
    });
  }

  const openLeaveTasks = await prisma.almaTask.findMany({
    where: { sourceApp: 'STAFF', sourceRefType: 'leave', status: { in: [...OPEN_STATUSES] } },
    select: { sourceRefId: true }
  });
  for (const task of openLeaveTasks) {
    if (task.sourceRefId && !qualifying.has(task.sourceRefId)) {
      await resolveTasksFromSource('STAFF', 'leave', task.sourceRefId);
    }
  }
}

export const taskSyncService = {
  // Reconcile every wired source. Throttled unless forced. Failures in
  // one reconciler don't block the others or the caller.
  async reconcile(force = false): Promise<{ reconciled: boolean }> {
    const startedAt = Date.now();
    if (!force && startedAt - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) {
      return { reconciled: false };
    }
    lastReconcileAt = startedAt;
    const now = new Date();
    const results = await Promise.allSettled([reconcileIssues(now), reconcileLeave(), pruneResolvedTasks(now)]);
    for (const result of results) {
      if (result.status === 'rejected') {
        // Log but don't throw — a bad reconciler shouldn't break the task list.
        console.error('[task-sync] reconciler failed:', result.reason);
      }
    }
    return { reconciled: true };
  }
};
